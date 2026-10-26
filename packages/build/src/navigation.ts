import { basename, resolve } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { parse } from '@babel/parser';
import type { BuildOptions, BuildResult, Plugin } from 'esbuild';
import type { BuildConfig, NavigationGroup } from './types.js';
import type { EntryProducts } from './entry-products.js';

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
export const navigationFilename = (group: NavigationGroup): string => `forma-navigation-${group.id}.js`;

/** Refuse ambiguous ownership before staging or replacing an existing build. */
export function validateNavigation(config: BuildConfig): void {
  if (config.navigationGroups === undefined) return;
  const fail = (detail: string): never => { throw new Error(`BUILD-827 navigationGroups: ${detail}`); };
  if (!Array.isArray(config.navigationGroups)) fail('expected an array');
  if (!config.navigationGroups.length) return;
  if (!config.ssr || config.watch || config.codeSplitting) fail('requires production SSR without watch or codeSplitting');
  const ids = new Set<string>(), owners = new Set<string>();
  const filenames = new Set(config.entryPoints.map(entry => entry.outfile));
  const physicalEntries = new Set<string>();
  for (const group of config.navigationGroups) {
    if (!group || typeof group.id !== 'string' || !IDENTIFIER.test(group.id) || ids.has(group.id)) fail('group IDs must be unique ASCII identifiers of 1–128 characters');
    ids.add(group.id);
    if (filenames.has(navigationFilename(group))) fail(`reserved bootstrap filename ${navigationFilename(group)}`);
    if (typeof group.client !== 'string' || !group.client) fail(`group ${group.id} needs its initialization module`);
    if (!Array.isArray(group.owners) || !group.owners.length || group.owners.length > 32) fail(`group ${group.id} needs 1–32 native owners`);
    let assets: string | undefined;
    for (const owner of group.owners) {
      if (typeof owner !== 'string' || !IDENTIFIER.test(owner) || owners.has(owner)) fail('each owner must be a unique ASCII identifier in exactly one group');
      owners.add(owner);
      const entry = config.entryPoints.find(item => item.outfile === `${owner}.js`);
      if (!entry || entry.ssr === false) fail(`owner ${owner} must select an existing native entry`);
      const physical = realpathSync(entry!.entry);
      if (physicalEntries.has(physical)) fail(`owner ${owner} must have a distinct declaration entry`);
      physicalEntries.add(physical);
      if (config.serverInlined?.includes(entry!.outfile)) fail(`owner ${owner} cannot be server-inlined`);
      const routes = Object.entries(config.routes).filter(([, mapping]) => mapping.js?.[0] === owner);
      if (!routes.length) fail(`owner ${owner} needs a route mapping for its native PageHandle`);
      for (const [path, mapping] of routes) {
        if (mapping.js.length !== 1) fail(`route ${path} cannot request additional scripts`);
        const selected = JSON.stringify([mapping.css, mapping.fonts ?? null]);
        if (assets !== undefined && selected !== assets) fail(`all routes in group ${group.id} must have identical CSS and font sets`);
        assets = selected;
      }
    }
  }
}

/** Every declaration and executable dependency is bundled in this one entry.
 * No fetched HTML or server response can add executable code to the registry. */
export function navigationOptions(config: BuildConfig, group: NavigationGroup,
  options: Partial<BuildOptions>): BuildOptions {
  const entries = group.owners.map(owner => config.entryPoints.find(entry => entry.outfile === `${owner}.js`)!);
  const imports = entries.map((entry, index) => `import {__formaNavigationRegistry as r${index}} from ${JSON.stringify(resolve(entry.entry))};`);
  const contents = `${imports.join('\n')}
import initialize from ${JSON.stringify(resolve(group.client))};
const registrations = Object.freeze(Object.assign(Object.create(null), ${entries.map((_, index) => `r${index}`).join(', ')}));
await initialize(Object.freeze({ registrations, app: ${JSON.stringify(config.app)}, build: __FORMA_BUILD__, group: ${JSON.stringify(group.id)}, owners: Object.freeze(${JSON.stringify(group.owners)}) }));`;
  return { ...options, entryPoints: undefined, stdin: { contents, resolveDir: process.cwd(), sourcefile: navigationFilename(group), loader: 'js' },
    outfile: resolve(config.outputDir, navigationFilename(group)), splitting: false, metafile: true, write: false };
}

/** Consume actual compiler products, never authored labels as proof of an owner. */
export function validateNavigationProduct(group: NavigationGroup, result: BuildResult, products: EntryProducts): void {
  const scripts = result.outputFiles?.filter(file => file.path.endsWith('.js')) ?? [];
  if (scripts.length !== 1 || basename(scripts[0].path) !== navigationFilename(group)
    || !result.metafile || Object.values(result.metafile.outputs).some(output => output.imports.length > 0)
    || result.outputFiles?.some(file => !file.path.endsWith('.js') && !file.path.endsWith('.ir'))) {
    throw new Error('BUILD-827 navigation bootstrap must contain its entire executable graph with no external imports or separate assets');
  }
  const names = new Map<string, string>();
  for (const owner of group.owners) {
    const product = products.get(`${owner}.js`);
    if (!product || product.mode !== 'ssr' || product.navigationOutlet === undefined) throw new Error(`BUILD-827 missing checked native owner ${owner}`);
    for (const island of product.islands) {
      if (island.mode !== 'ssr' || !island.declaration || !island.contract) throw new Error(`BUILD-827 owner ${owner} requires native island declarations`);
      const identity = JSON.stringify([island.declaration, island.contract]);
      if (names.has(island.name) && names.get(island.name) !== identity) throw new Error(`BUILD-827 conflicting island registration ${island.name}`);
      names.set(island.name, identity);
    }
  }
}

/** esbuild does not report import(variable) as a dependency edge. Reject it
 * before bundling so the one verified script really closes executable imports. */
export function navigationExecutableGuard(): Plugin {
  return { name: 'forma-navigation-closed-imports', setup(builder) {
    builder.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, args => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes('import') && !source.includes('require')) return undefined;
      const ast = parse(source, { sourceType: 'unambiguous', plugins: [
        ...(/\.[cm]?tsx?$/.test(args.path) ? ['typescript' as const] : []),
        ...(/\.[jt]sx$/.test(args.path) ? ['jsx' as const] : []),
        'decorators-legacy',
      ] });
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        const node = value as { type?: string; callee?: { type?: string; name?: string }; arguments?: { type?: string }[]; source?: { type?: string } };
        if ((node.type === 'CallExpression' && (node.callee?.type === 'Import' || node.callee?.type === 'Identifier' && node.callee.name === 'require')
          && (node.arguments?.length !== 1 || node.arguments[0].type !== 'StringLiteral'))
          || (node.type === 'ImportExpression' && node.source?.type !== 'StringLiteral')) {
          throw new Error(`BUILD-827 navigation bootstrap cannot contain a dynamic import expression or require expression in ${args.path}; use a literal bundled import`);
        }
        for (const [key, child] of Object.entries(node)) if (!['loc', 'comments', 'tokens'].includes(key)) visit(child);
      };
      visit(ast);
      return undefined;
    });
  } };
}
