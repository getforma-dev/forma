/**
 * The two browser bundles of a corpus module, built in-process with esbuild, `formajs` and
 * `@getforma/core` resolved through a pass-through module to the one served core instance.
 * The pass-through records activation promises without changing their timing or result.
 *
 * - The twin: the module's page function, exported as `Page`, for core's render of a state (P1).
 * - The entry: the module's own `app.ts` built through `formaSsrPlugin`, as `@getforma/build`
 *   builds an application's page: the compile-time mount removed and the literal registry rewritten
 *   with the compiled registrations (`__islandRegistration(component, {h, schema, mode})`). Its
 *   evaluation is the page's activation (P2). The plugin also emits the module's `.ir`, which must
 *   be the committed corpus bytes the server renders, or the pair is not a pair.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { formaSsrPlugin, getSsrEntryProducts } from '@getforma/compiler';
import { REPO } from './server.mts';
import { jsxNamespaceFallback } from '../../../packages/build/src/jsx-namespace.ts';

export const CORE_URL = '/_parity/core.mjs';
export const ENTRY_CORE_URL = '/_parity/entry-core.mjs';
export const ENTRY_CORE_SOURCE = `
export * from '${CORE_URL}';
import { activateIslands as activate } from '${CORE_URL}';
const pending = [];
export function activateIslands(...args) {
  const ready = activate(...args);
  pending.push(ready);
  return ready;
}
export async function waitForActivation() {
  while (pending.length) await Promise.all(pending.splice(0));
}
`;

export interface PageComponent {
  /** Repository-relative path of the file exporting the page function. */
  readonly file: string;
  readonly exportName: string;
  /** `none`: called with no argument; otherwise the state object is the one argument. */
  readonly props: 'none' | 'named' | 'destructured';
}

const coreExternal: esbuild.Plugin = {
  name: 'parity-core',
  setup(build) {
    build.onResolve({ filter: /^(formajs|@getforma\/core)$/ }, () => ({ path: ENTRY_CORE_URL, external: true }));
  },
};

const common = {
  bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022', logLevel: 'silent',
  jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment',
} as const;

/** The page component as one ESM bundle exporting `Page`. */
export async function bundlePage(component: PageComponent): Promise<string> {
  const file = resolve(REPO, component.file);
  const result = await esbuild.build({
    ...common,
    stdin: { contents: `export { ${component.exportName} as Page } from ${JSON.stringify(file)};`, resolveDir: dirname(file), loader: 'ts' },
    // Match the ordinary Browser build's JSX namespace pass; raw esbuild alone
    // creates dual-use SVG names in HTML before their parent exists.
    plugins: [coreExternal, jsxNamespaceFallback()],
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error(`bundling ${component.file} produced no output`);
  return out.text;
}

export interface Entry {
  /** The browser entry, or null when the page has no island (its product ships no script). */
  readonly js: string | null;
  /** The `.ir` the same compilation emitted. */
  readonly ir: Uint8Array;
  readonly islands: readonly { readonly name: string; readonly mode: 'ssr' | 'browserOnly' }[];
  /** The compiler's diagnostics for the page, `CODE file:line message`, which often explain a divergence (BUILD-206). */
  readonly diagnostics: readonly string[];
}

/** A module-exported setter for P3: the file exporting it and its export name (corpus.json's `transition`). */
export interface Transition { readonly file: string; readonly export: string }

/**
 * The module's entry (`app.ts`) through the compiler's SSR plugin, as an application's build runs
 * it. With a transition, the bundle's entry is a two-line wrapper that imports the app entry (so
 * activation runs as it would) and re-exports the setter as `__parityTransition` from the same
 * module graph, so the setter reaches the activated islands' own instances.
 */
export async function bundleEntry(name: string, entryFile: string, transition?: Transition): Promise<Entry> {
  const entry = resolve(REPO, entryFile);
  if (!existsSync(entry)) throw new Error(`${name}: no entry ${entry}`);
  const input = transition
    ? { stdin: { contents: `import ${JSON.stringify(entry)};\nexport { ${transition.export} as __parityTransition } from ${JSON.stringify(resolve(REPO, transition.file))};\n`, resolveDir: dirname(entry), loader: 'ts' as const } }
    : { entryPoints: [entry] };
  // The plugin logs one line per emission and each diagnostic; the harness keeps the diagnostics
  // with the module instead, and its own report is the output.
  const log = console.log, warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const diagnostics: string[] = [];
  let result: esbuild.BuildResult<{ write: false }>;
  try {
    result = await esbuild.build({
      ...common,
      ...input,
      outdir: resolve('/parity-out', name),
      plugins: [coreExternal, formaSsrPlugin({ page: name, outDir: resolve('/parity-out', name), entryPoint: entry, strict: false, onDiagnostics: found => {
        for (const d of found) diagnostics.push(`${d.code} ${d.file.slice(REPO.length)}:${d.line} ${d.message.split(' — ')[0]}`);
      } })],
    });
  } finally {
    console.log = log;
    console.warn = warn;
  }
  const [product] = getSsrEntryProducts(result);
  if (!product) throw new Error(`${name}: the compiler recorded no SSR product`);
  const ir = result.outputFiles.find(file => file.path === product.irFile);
  const js = result.outputFiles.find(file => file.path.endsWith('.js'));
  if (!ir) throw new Error(`${name}: the compiler emitted no .ir`);
  return { js: js && js.contents.length > 0 ? js.text : null, ir: ir.contents, islands: product.islands, diagnostics: [...new Set(diagnostics)] };
}
