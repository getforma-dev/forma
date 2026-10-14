import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TEMPLATES, TEMPLATE_INFO } from '../src/scaffold';
import { TEMPLATES_DIR, listFiles } from './helpers';

/**
 * Structural assertions about the template sources.
 *
 * These deliberately parse (JSON, TOML-ish, file inventories) rather than
 * grepping for substrings: the previous suite asserted that main.rs
 * "contains 127.0.0.1", which a commented-out line satisfies just as well as
 * a bind call.
 */

function readJson(...segments: string[]): any {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, ...segments), 'utf8'));
}

/** Drop `//` line comments so a claim in prose cannot satisfy a code assertion. */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

function cargoField(template: string, field: string): string | undefined {
  const toml = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'Cargo.toml'), 'utf8');
  const pkg = toml.split(/^\[/m)[1] ?? '';
  const line = pkg.split('\n').find((l) => l.trim().startsWith(`${field} =`));
  return line?.split('=')[1]?.trim().replace(/^"|"$/g, '');
}

function cargoDeps(template: string): string[] {
  const toml = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'Cargo.toml'), 'utf8');
  const section = toml.split('[dependencies]')[1] ?? '';
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('['))
    .map((l) => l.split('=')[0]!.trim());
}

/** The `[[package]]` entries of a Cargo.lock, as name/version/source/checksum/dependencies. */
function cargoLockPackages(template: string) {
  // A Windows checkout may carry CRLF, which `$` in a multiline regex does not match.
  const lock = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'Cargo.lock'), 'utf8').replace(/\r\n/g, '\n');
  return lock
    .split(/^\[\[package\]\]$/m)
    .slice(1)
    .map((block) => {
      const field = (key: string) => new RegExp(`^${key} = "([^"]*)"$`, 'm').exec(block)?.[1];
      const deps = /^dependencies = \[([\s\S]*?)^\]/m.exec(block)?.[1] ?? '';
      return {
        name: field('name'),
        version: field('version'),
        source: field('source'),
        checksum: field('checksum'),
        // A dependency is written `"name"`, or `"name version"` when two
        // versions of it are in the graph.
        dependencies: [...deps.matchAll(/"([^" ]+)[^"]*"/g)].map((m) => m[1]!),
      };
    });
}

/**
 * Whether `version` satisfies a caret range such as `^0.2.0` or `^2.0.0`.
 * Every range the templates declare is a caret range; anything else fails
 * loudly here rather than being half-understood.
 */
function satisfiesCaret(version: string, range: string): boolean {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) throw new Error(`not a caret range: ${range}`);
  const want = m.slice(1).map(Number) as [number, number, number];
  const have = version.split('-')[0]!.split('.').map(Number) as [number, number, number];
  if (version.includes('-')) return false; // a prerelease never satisfies a plain caret range
  const atLeast =
    have[0] !== want[0] ? have[0] > want[0]
    : have[1] !== want[1] ? have[1] > want[1]
    : have[2] >= want[2];
  // ^1.2.3 holds the major; ^0.2.3 holds the minor too; ^0.0.3 holds the patch.
  const sameLine =
    want[0] > 0 ? have[0] === want[0]
    : want[1] > 0 ? have[0] === 0 && have[1] === want[1]
    : have[0] === 0 && have[1] === 0 && have[2] === want[2];
  return atLeast && sameLine;
}

/**
 * Every text source in a template, comments stripped, README excluded.
 *
 * Both exclusions matter: the dashboard's `build.ts` explains in a comment
 * that an SSR build of it would produce "island placeholders", and its README
 * says the same at length — so a grep that kept prose would find "island" in a
 * template that never hydrates one.
 */
function templateCode(template: string): string {
  const root = path.join(TEMPLATES_DIR, template);
  return listFiles(root)
    .filter((f) => /\.(ts|tsx|rs|json|css|html|toml)$/.test(f))
    .map((f) => stripComments(fs.readFileSync(path.join(root, f), 'utf8')))
    .join('\n');
}

describe('TEMPLATES constant', () => {
  it('matches the directories actually shipped', () => {
    const onDisk = fs
      .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect([...TEMPLATES].sort()).toEqual(onDisk);
  });
});

describe.each(TEMPLATES)('%s template description', (template) => {
  /**
   * `TEMPLATE_INFO` is what the picker and `--help` show, and a user chooses a
   * template from it — so it is documentation, and it has to be true. The
   * dashboard was advertised as "Live dashboard with islands" while neither
   * template calls `activateIslands`: it is a client-mounted app. Nothing
   * could catch that, because no test compared the advertised feature list
   * against the template it describes.
   */
  const description = TEMPLATE_INFO[template]!.description;
  const code = templateCode(template);

  // Each row: a feature the description may claim, and the mechanical
  // evidence that the template really has it.
  const FEATURES: Array<{ claim: RegExp; evidence: RegExp; what: string }> = [
    { claim: /islands?/i, evidence: /activateIslands\s*\(/, what: 'a call to activateIslands' },
    { claim: /\bAPI routes?\b/i, evidence: /\.route\("\/api\//, what: 'an /api/* route in main.rs' },
    { claim: /\bSSR\b|Phase 2/i, evidence: /ssrEntryPoints/, what: 'an ssrEntryPoints build config' },
    { claim: /SVG chart/i, evidence: /<svg/, what: 'an <svg> element' },
  ];

  it('advertises only features the template actually has', () => {
    for (const { claim, evidence, what } of FEATURES) {
      if (!claim.test(description)) continue;
      expect(
        evidence.test(code),
        `${template} is advertised as "${description}" but its sources contain no ${what}`,
      ).toBe(true);
    }
  });

  it('counts the pages and API routes it claims, and claims no number this test cannot check', () => {
    const checked: string[] = [];

    const pages = description.match(/(\d+)\s+pages?/i);
    if (pages) {
      const dir = path.join(TEMPLATES_DIR, template, 'admin', 'src', 'pages');
      const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')) : [];
      expect(onDisk.length, `claims ${pages[1]} pages, ships ${onDisk.length}`).toBe(Number(pages[1]));
      checked.push(pages[1]!);
    }

    const api = description.match(/(\d+)\s+JSON API routes?/i);
    if (api) {
      const main = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8');
      const routes = [...main.matchAll(/\.route\("(\/api\/[^"]+)"/g)].map((m) => m[1]);
      expect(new Set(routes).size, `claims ${api[1]} API routes, serves ${routes.length}`).toBe(
        Number(api[1]),
      );
      checked.push(api[1]!);
    }

    // Two-sided: a number nobody verifies is how "162 tests" survived five
    // releases in a sibling repo. `Phase 2` is a name, not a count.
    const claimed = [...description.replace(/Phase \d/g, '').matchAll(/\b(\d+)\b/g)].map((m) => m[1]!);
    expect(
      claimed.filter((n) => !checked.includes(n)),
      `${template}'s description contains a number this test does not verify — add a check or drop the number`,
    ).toEqual([]);
  });
});

describe.each(TEMPLATES)('%s template', (template) => {
  const files = listFiles(path.join(TEMPLATES_DIR, template));

  it('ships no installed dependencies and no build output', () => {
    expect(files.filter((f) => /(^|\/)(node_modules|dist|target)\//.test(f))).toEqual([]);
  });

  it('ships an npm lockfile that agrees with package.json and resolves only from the npm registry', () => {
    // The templates ship their lockfiles (DR-32): a new project installs the
    // set the scaffold gate installed, not whatever resolves on the day. The
    // risk that once kept them out is staleness: a March lockfile once held
    // new projects on @getforma/core 1.0.6 while package.json asked for more.
    // So the lockfile has to agree with package.json here, in `npm test`, and
    // not only in the scaffold gate's `npm ci`.
    expect(files).toContain('admin/package-lock.json');
    const pkg = readJson(template, 'admin', 'package.json');
    const lock = readJson(template, 'admin', 'package-lock.json');
    expect(lock.lockfileVersion).toBe(3);

    const root = lock.packages[''];
    expect(root.dependencies ?? {}, 'regenerate admin/package-lock.json').toEqual(pkg.dependencies ?? {});
    expect(root.devDependencies ?? {}, 'regenerate admin/package-lock.json').toEqual(pkg.devDependencies ?? {});

    // Each direct dependency is locked at a version its declared range admits.
    const direct = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    for (const [name, range] of Object.entries(direct)) {
      const locked = lock.packages[`node_modules/${name}`]?.version;
      expect(locked, `${name} is not in the lockfile`).toBeTruthy();
      expect(satisfiesCaret(locked, range), `${name}@${locked} is outside ${range}`).toBe(true);
    }

    // Every downloaded package comes from the public registry with a sha512
    // integrity hash. Bundled packages ship inside their parent's tarball and
    // carry neither.
    for (const [key, entry] of Object.entries<any>(lock.packages)) {
      if (key === '' || entry.inBundle) continue;
      expect(entry.link, `${key} is a link`).toBeUndefined();
      expect(entry.resolved, `${key} resolves elsewhere`).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, `${key} has no sha512 integrity`).toMatch(/^sha512-/);
    }
  });

  it('ships a Cargo.lock that locks its crates from crates.io under its placeholder name', () => {
    // The Rust half of the same rule. The crate's own entry carries the
    // placeholder, which the scaffolder rewrites and re-sorts.
    expect(files).toContain('Cargo.lock');
    const packages = cargoLockPackages(template);
    const roots = packages.filter((p) => p.source === undefined);
    expect(roots.map((p) => p.name)).toEqual([cargoField(template, 'name')]);
    expect(roots[0]!.version).toBe(cargoField(template, 'version'));
    // The crate's direct dependencies in the lockfile are the ones Cargo.toml declares.
    expect([...roots[0]!.dependencies].sort(), 'regenerate Cargo.lock').toEqual([...cargoDeps(template)].sort());
    for (const p of packages.filter((q) => q.source !== undefined)) {
      expect(p.source, `${p.name} comes from elsewhere`).toBe('registry+https://github.com/rust-lang/crates.io-index');
      expect(p.checksum, `${p.name} has no checksum`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('names the crate after the project-name placeholder', () => {
    const name = cargoField(template, 'name');
    expect(name === '{{PROJECT_NAME}}' || name === '{{project-name}}').toBe(true);
  });

  it('declares exactly the crates its Rust sources use', () => {
    const srcDir = path.join(TEMPLATES_DIR, template, 'src');
    const rust = fs
      .readdirSync(srcDir)
      .filter((f) => f.endsWith('.rs'))
      .map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8'))
      .join('\n');
    const deps = cargoDeps(template);
    for (const dep of deps) {
      const crate = dep.replace(/-/g, '_');
      // An unused dependency is a slower build and a wider supply chain for
      // nothing — this is what caught forma-ir surviving the dashboard's SSR
      // removal.
      expect(rust.includes(crate), `${dep} is declared but never used in src/*.rs`).toBe(true);
    }
    // ...and nothing used is missing.
    for (const crate of ['axum', 'forma_server', 'rust_embed', 'tokio']) {
      expect(deps.map((d) => d.replace(/-/g, '_'))).toContain(crate);
    }
  });

  it('binds to loopback and never to a wildcard address', () => {
    const main = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8');
    const code = main
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).toContain('127.0.0.1');
    expect(code).not.toContain('0.0.0.0');
  });

  it('sends every rendered page through PageOutput::headers(), so no-store travels with the nonce', () => {
    // The nonce in a page's policy is per request and only matches the HTML
    // from the same render_page call, and a cached copy would replay one
    // nonce to every visitor. forma-server's PageOutput::headers() sends the
    // policy with `Cache-Control: no-store` and the document headers; a page
    // that assembles its own headers is how the minimal template came to
    // send no `no-store` at all (DR-17).
    const main = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8'),
    );
    const renders = main.match(/render_page\(/g)?.length ?? 0;
    expect(renders).toBeGreaterThan(0);
    expect(main.match(/page\.headers\(\)/g)?.length ?? 0).toBe(renders);
    // ...and no page builds the policy or the cache header by hand.
    expect(main).not.toContain('page.csp');
    expect(main).not.toMatch(/content-security-policy|CONTENT_SECURITY_POLICY|CACHE_CONTROL/i);
  });

  it('installs a tracing subscriber so forma-server fallbacks are visible', () => {
    // render_page degrades Phase 2 -> Phase 1 through tracing::warn!. With no
    // subscriber that warning is discarded and a broken SSR build is
    // indistinguishable from a working client-rendered one.
    const main = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8');
    expect(main).toContain('tracing_subscriber::fmt::init()');
  });

  it('pins frontend dependencies at or above the versions whose fixes it needs', () => {
    const pkg = readJson(template, 'admin', 'package.json');
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    // core 2.0.0: the new Function fallback is deleted, so the runtime is
    // CSP-safe with nothing left to misconfigure; expressions evaluate through
    // an allowlist AST interpreter that cannot reach a global.
    expect(all['@getforma/core']).toBe('^2.0.0');
    // build 0.2.0: below this the Tailwind step spawned npx via execFileSync,
    // which cannot work on Windows, and every build emitted an island registry
    // that resolved from nowhere and had to be deleted by hand.
    expect(all['@getforma/build']).toBe('^0.2.0');
    expect(pkg.engines?.node).toBe('>=20.19.0');
  });

  it('has a JSX-to-h() tsconfig', () => {
    const tsconfig = readJson(template, 'admin', 'tsconfig.json');
    expect(tsconfig.compilerOptions.jsx).toBe('react');
    expect(tsconfig.compilerOptions.jsxFactory).toBe('h');
    expect(tsconfig.compilerOptions.jsxFragmentFactory).toBe('Fragment');
  });

  it('ships a _gitignore that covers secrets and build output', () => {
    const lines = fs
      .readFileSync(path.join(TEMPLATES_DIR, template, '_gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    for (const pattern of ['target/', 'node_modules/', 'dist/', '.env', '.env.*', '*.pem', '*.key']) {
      expect(lines, `${template}/_gitignore is missing ${pattern}`).toContain(pattern);
    }
    // Cargo.lock belongs in an application's history.
    expect(lines).not.toContain('Cargo.lock');
  });

  it('uses no real .gitignore, which npm pack would rename to .npmignore', () => {
    expect(files).not.toContain('.gitignore');
    expect(files).toContain('_gitignore');
  });
});

describe('minimal template', () => {
  it('keeps its SSR root as literal JSX inside the mount callback', () => {
    // The FMIR compiler walks source; a component tag or a JSX-returning
    // helper degrades to an island placeholder with no content, which is the
    // difference between real IR and a 605-byte shell.
    const app = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'minimal', 'admin', 'src', 'home', 'app.tsx'),
      'utf8',
    );
    expect(app).toMatch(/mount\(\(\) => \{[\s\S]*return \(/);
    // No capitalised JSX tags — those are component tags.
    expect(app).not.toMatch(/<[A-Z]/);
  });

  it('keys its SSR entry points by page name, as @getforma/build reads them', () => {
    // @getforma/build 0.2.0 looks an SSR entry up as
    // `ssrEntryPoints[basename(outfile, '.js')]`, the page name, and falls back
    // to the browser entry when the key is missing. The template keyed it by
    // route ('/'), which the build never read; it worked only because the
    // fallback happened to be the same file. The scaffold gate proves the key
    // is read ("minimal: build:ssr reads ssrEntryPoints by page name").
    const build = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, 'minimal', 'admin', 'build.ts'), 'utf8'),
    );
    const entries = /entryPoints:\s*\[([\s\S]*?)\]/.exec(build)?.[1] ?? '';
    const pages = [...entries.matchAll(/outfile:\s*'([^']+)\.js'/g)].map((m) => m[1]);
    expect(pages).toEqual(['home']);

    const ssr = /ssrEntryPoints:\s*\{([^}]*)\}/.exec(build)?.[1] ?? '';
    const keyed = [...ssr.matchAll(/(?:'([^']+)'|"([^"]+)"|([\w$]+))\s*:\s*'([^']+)'/g)].map((m) => ({
      key: m[1] ?? m[2] ?? m[3],
      file: m[4]!,
    }));
    expect(keyed.length, `no ssrEntryPoints found in build.ts`).toBeGreaterThan(0);
    for (const { key, file } of keyed) {
      expect(pages, `ssrEntryPoints key '${key}' is not a page name`).toContain(key);
      expect(fs.existsSync(path.join(TEMPLATES_DIR, 'minimal', 'admin', file)), `${file} does not exist`).toBe(true);
    }
  });

  it('pins @getforma/compiler, which is what emits the IR', () => {
    const pkg = readJson('minimal', 'admin', 'package.json');
    // 0.3.0 resolves components exported the way esbuild emits them, so a .tsx
    // page no longer compiles to an empty div; it also gives every slot family
    // a page-unique name and gives show branches and dynamic text their SSR
    // defaults, so the server stops rendering the wrong branch.
    expect(pkg.devDependencies['@getforma/compiler']).toBe('^0.3.0');
  });

  it('loads IR modules and passes slots, so Phase 2 is reachable', () => {
    const main = fs.readFileSync(path.join(TEMPLATES_DIR, 'minimal', 'src', 'main.rs'), 'utf8');
    expect(main).toContain('load_ir_modules::<Assets>');
    // render_page falls straight back to Phase 1 unless BOTH ir_module and
    // slots are Some — `slots: None` is what made the dashboard's SSR dead.
    expect(main).toContain('slots: slots.as_ref()');
    expect(main).toContain('SlotData::new_from_defaults');
  });

  it('styles through a CSS entry rather than style attributes', () => {
    // Not a CSP requirement — `style-src-attr 'unsafe-inline'` permits style
    // attributes. A stylesheet is preferred because it is cached, hashed and
    // served from /_assets instead of repeating in every response.
    const app = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'minimal', 'admin', 'src', 'home', 'app.tsx'),
      'utf8',
    );
    expect(app).not.toMatch(/style=/);
    const build = fs.readFileSync(path.join(TEMPLATES_DIR, 'minimal', 'admin', 'build.ts'), 'utf8');
    expect(build).toContain('cssEntries');
    expect(fs.existsSync(path.join(TEMPLATES_DIR, 'minimal', 'admin', 'src', 'styles', 'app.css'))).toBe(true);
  });
});

describe('dashboard template', () => {
  it('does not configure SSR, and offers no build:ssr script to reach for', () => {
    // Measured: with SSR on, the emitted IR renders to island placeholders and
    // 14 of the template's 16 Playwright tests fail. See the README.
    const build = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'admin', 'build.ts'), 'utf8'),
    );
    expect(build).not.toContain('ssr:');
    expect(build).not.toContain('ssrEntryPoints');
    const pkg = readJson('dashboard', 'admin', 'package.json');
    expect(pkg.scripts['build:ssr']).toBeUndefined();
    // ...and no compiler dependency, since nothing emits IR here.
    expect(pkg.devDependencies['@getforma/compiler']).toBeUndefined();
  });

  it('asks for Phase 1 explicitly instead of computing a mode it discards', () => {
    const main = fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'src', 'main.rs'), 'utf8');
    expect(main).toContain('render_mode: RenderMode::Phase1ClientMount');
    expect(main).not.toContain('load_ir_modules');
  });

  it('routes every page and every documented API endpoint', () => {
    const main = fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'src', 'main.rs'), 'utf8');
    const routes = [...main.matchAll(/\.route\("([^"]+)"/g)].map((m) => m[1]);
    for (const page of ['/', '/overview', '/deployments', '/servers', '/settings']) {
      expect(routes).toContain(page);
    }
    const apiRoutes = routes.filter((r) => r!.startsWith('/api/')).sort();
    expect(apiRoutes).toEqual([
      '/api/deployment-stats',
      '/api/deployments',
      '/api/incidents',
      '/api/metrics',
      '/api/request-volume',
      '/api/service-summary',
      '/api/servers',
      '/api/services',
    ].sort());

    // Every API route the README documents must exist, and vice versa.
    const readme = fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'README.md'), 'utf8');
    const documented = [...readme.matchAll(/`GET (\/api\/[a-z-]+)`/g)].map((m) => m[1]).sort();
    expect(documented).toEqual(apiRoutes);
  });

  it('warns in the README that the API routes are unauthenticated', () => {
    const readme = fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'README.md'), 'utf8');
    expect(readme).toMatch(/no authentication/i);
    expect(readme).toContain('FORMA_HOST');
  });

  it('claims the number of Playwright tests it actually has', () => {
    const spec = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'dashboard', 'admin', 'tests', 'dashboard.spec.ts'),
      'utf8',
    );
    const count = [...spec.matchAll(/^\s{2}test\(/gm)].length;
    const readme = fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'README.md'), 'utf8');
    expect(count).toBeGreaterThan(0);
    expect(readme).toContain(`${count} Playwright E2E tests`);
    expect(readme).toContain(`${count} tests.`);
  });
});
