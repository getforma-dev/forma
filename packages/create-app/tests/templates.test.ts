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

  it('ships no lockfile, no installed dependencies and no build output', () => {
    // A committed admin/package-lock.json is how this template shipped
    // five-month-old pins that could not build on Windows: `npm install`
    // honours the lockfile and ignores the ranges in package.json.
    expect(files.filter((f) => f.endsWith('package-lock.json'))).toEqual([]);
    expect(files.filter((f) => /(^|\/)(node_modules|dist|target)\//.test(f))).toEqual([]);
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

  it('sends the Content-Security-Policy that render_page generated', () => {
    const main = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8');
    // The nonce in page.csp is per-request and only matches the HTML from the
    // same render_page call, so the header has to come from page.csp itself.
    expect(main).toContain('content-security-policy');
    expect(main).toContain('page.csp');
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

  it('configures an SSR entry point for /', () => {
    const build = fs.readFileSync(path.join(TEMPLATES_DIR, 'minimal', 'admin', 'build.ts'), 'utf8');
    expect(build).toContain("ssrEntryPoints: { '/': 'src/home/app.tsx' }");
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
