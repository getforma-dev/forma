import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TEMPLATES, TEMPLATE_INFO } from '../src/scaffold';
import { REPO_ROOT, TEMPLATES_DIR, listFiles, run, runCli, mkTmpDir, rmrf } from './helpers';
import { collectDiagnostics, generateRealIr } from '../../compiler/src/index';
import { getSlots } from '../../compiler/tests/helpers/fmir';

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

/** The templates preserve their existing consumer toolchain floor. */
const RUST_FLOOR = '1.85';
const SOURCE_VERSION = readJson('..', 'package.json').version;
const INTERNAL_NPM = new Set(['@getforma/core', '@getforma/compiler', '@getforma/build']);
const INTERNAL_CRATES = new Set(['forma-ir', 'forma-ir-derive', 'forma-server']);

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
      // A dependency is written `"name"`, or `"name version"` when two
      // versions of it are in the graph.
      const refs = [...deps.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      return {
        name: field('name'),
        version: field('version'),
        source: field('source'),
        checksum: field('checksum'),
        refs,
        dependencies: refs.map((r) => r.split(' ')[0]!),
      };
    });
}

/**
 * Each `[dependencies]` entry of a template's Cargo.toml and its version
 * requirement, from `name = "req"` or `name = { version = "req", ... }`.
 */
function cargoRequirements(template: string): Record<string, string> {
  const toml = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'Cargo.toml'), 'utf8');
  const section = toml.split('[dependencies]')[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of section.split('\n').map((l) => l.trim())) {
    const m = /^([\w-]+)\s*=\s*(?:"([^"]+)"|\{.*\bversion\s*=\s*"([^"]+)")/.exec(line);
    if (m) out[m[1]!] = m[2] ?? m[3]!;
  }
  return out;
}

/**
 * A Cargo requirement as the caret range it means: a bare `0.2` is `^0.2.0`,
 * `1` is `^1.0.0`. Any other operator fails loudly rather than half-understood.
 */
function cargoCaret(requirement: string): string {
  const bare = requirement.replace(/^\^/, '');
  if (!/^\d+(\.\d+){0,2}$/.test(bare)) throw new Error(`unsupported Cargo requirement: ${requirement}`);
  const [major, minor = '0', patch = '0'] = bare.split('.');
  return `^${major}.${minor}.${patch}`;
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

  it('packs the install policy under _npmrc so npm does not silently drop it', () => {
    const packed = run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], REPO_ROOT);
    expect(packed.status, packed.stderr).toBe(0);
    const paths = JSON.parse(packed.stdout)[0].files.map((f: { path: string }) => f.path);
    expect(paths).toContain(`templates/${template}/admin/_npmrc`);
    expect(fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', '_npmrc'), 'utf8')).toContain('ignore-scripts=true');
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
      expect(range.startsWith('=') ? locked === range.slice(1) : satisfiesCaret(locked, range), `${name}@${locked} is outside ${range}`).toBe(true);
    }

    // Every downloaded package comes from the public registry with a sha512
    // integrity hash. Bundled packages ship inside their parent's tarball and
    // carry neither.
    for (const [key, entry] of Object.entries<any>(lock.packages)) {
      if (key === '' || entry.inBundle) continue;
      expect(entry.link, `${key} is a link`).toBeUndefined();
      expect(entry.resolved, `${key} resolves elsewhere`).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      if (/^node_modules\/@getforma\/(core|compiler|build)$/.test(key)) {
        expect(entry.version).toBe(SOURCE_VERSION);
        expect(entry.integrity, 'only the identified source seed may omit internal archive hashes').toBeUndefined();
      } else expect(entry.integrity, `${key} has no sha512 integrity`).toMatch(/^sha512-/);
    }
  });

  it('keeps direct npm resolutions and authenticates candidate runtime copies against the workspace lock', () => {
    const pkg = readJson(template, 'admin', 'package.json');
    const lock = readJson(template, 'admin', 'package-lock.json');
    const workspace = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, '../../package-lock.json'), 'utf8'));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(lock.packages[`node_modules/${name}`], `${name}: missing direct resolution`).toBeDefined();
      const copies = Object.keys(lock.packages).filter(key => key.endsWith(`/node_modules/${name}`));
      for (const key of copies) {
        // Candidate closure additions come from recorded workspace bytes;
        // the older direct template resolution is deliberately preserved.
        expect(key).toMatch(/^node_modules\/@getforma\/(compiler|build)\/node_modules\/esbuild$/);
        for (const field of ['version', 'resolved', 'integrity']) {
          expect(lock.packages[key][field], `${key}: ${field}`).toBe(workspace.packages[`node_modules/${name}`][field]);
        }
      }
    }
  });

  it('ships a Cargo.lock that locks its crates from crates.io under its placeholder name', () => {
    // The Rust half of the same rule. The crate's own entry carries the
    // placeholder, which the scaffolder rewrites and re-sorts.
    expect(files).toContain('Cargo.lock');
    // The template declares forma-server 0.2.0's toolchain floor, and its
    // lockfile is resolved MSRV-aware against it, so a committed lockfile
    // never raises the Rust a new project needs (FORMA-015). Cargo.lock does
    // not record each crate's rust-version; the scaffold gate checks those
    // against the registry ("no locked crate needs a newer Rust than the
    // template declares").
    expect(cargoField(template, 'rust-version')).toBe(RUST_FLOOR);
    // ...and holds it through the user's own `cargo update` too: resolver 3
    // is cargo's MSRV-aware resolver, available from Cargo 1.84, below the floor.
    expect(cargoField(template, 'resolver')).toBe('3');
    const packages = cargoLockPackages(template);
    const roots = packages.filter((p) => p.source === undefined);
    expect(roots.map((p) => p.name)).toEqual([cargoField(template, 'name')]);
    expect(roots[0]!.version).toBe(cargoField(template, 'version'));
    // The crate's direct dependencies in the lockfile are the ones Cargo.toml declares.
    expect([...roots[0]!.dependencies].sort(), 'regenerate Cargo.lock').toEqual([...cargoDeps(template)].sort());
    // Each direct crate is locked at a version its requirement admits, so a
    // requirement moved without regenerating the lockfile fails here.
    for (const [crate, requirement] of Object.entries(cargoRequirements(template))) {
      const ref = roots[0]!.refs.find((r) => r.split(' ')[0] === crate);
      const locked = ref?.split(' ')[1] ?? packages.find((p) => p.name === crate && p.source)?.version;
      expect(locked, `${crate} is not locked`).toBeTruthy();
      expect(requirement.startsWith('=') ? locked === requirement.slice(1) : satisfiesCaret(locked!, cargoCaret(requirement)), `${crate}@${locked} is outside "${requirement}"`).toBe(true);
    }
    for (const p of packages.filter((q) => q.source !== undefined)) {
      expect(p.source, `${p.name} comes from elsewhere`).toBe('registry+https://github.com/rust-lang/crates.io-index');
      if (INTERNAL_CRATES.has(p.name!)) {
        expect(p.version).toBe(SOURCE_VERSION);
        expect(p.checksum, 'internal source seed checksum is sealed at pack time').toBeUndefined();
      } else expect(p.checksum, `${p.name} has no checksum`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('documents npm ci, never npm install, as the install step', () => {
    // A plain `npm install` may rewrite the shipped lockfile (npm 10 and 11
    // both rewrite the dashboard's), so a project nobody has touched would be
    // modified by its first documented step. `npm ci` never writes it.
    for (const rel of ['README.md', 'src/main.rs']) {
      const text = fs.readFileSync(path.join(TEMPLATES_DIR, template, rel), 'utf8');
      expect(text, `${template}/${rel}`).not.toMatch(/\bnpm install\b/);
      expect(text, `${template}/${rel}`).toContain('npm ci');
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
    expect(code.includes('127.0.0.1') || code.includes('Ipv4Addr::LOCALHOST')).toBe(true);
    expect(code).not.toContain('0.0.0.0');
  });

  it('renders every page with a typed handle or render_browser_shell and sends its PageResponse, so no-store travels with the nonce', () => {
    // The nonce in a page's policy is drawn per render and only matches that
    // render's HTML, and a cached copy would replay one nonce to every
    // visitor. A PageResponse writes the policy, `Cache-Control: no-store` and
    // the document headers whenever it is sent, and its HTML leaves without
    // them only through `into_parts_unchecked()`. render_page's PageOutput
    // left the headers to the handler, which is how the minimal template came
    // to send no `no-store` at all (DR-17).
    const main = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8'),
    );
    expect(main.match(/\b(?:render|render_browser_shell)\(/g)?.length ?? 0).toBeGreaterThan(0);
    expect(main).toMatch(/Ok\(page\) => page\.into_response\(\)/);
    // No page leaves any other way, and none builds the policy or the cache
    // header by hand.
    expect(main).not.toMatch(/\brender_page(?:_with_nonce)?\(/);
    expect(main).not.toContain('into_parts_unchecked');
    expect(main).not.toContain('PageOutput');
    // A failed render comes back as a RenderError, which the handler answers
    // with its own response rather than a panic (DR-11): a 500 that is never
    // cached or sniffed, the one place a template writes a cache header.
    expect(main).not.toMatch(/(?:render|render_browser_shell)\([^;]*?\)\s*\.(?:unwrap|expect)\(/);
    const errorArms = main.match(/Err\(error\) => \{[\s\S]*?\.into_response\(\)\s*\}/g) ?? [];
    expect(errorArms.length, 'no Err(error) arm answering a failed render').toBeGreaterThan(0);
    for (const arm of errorArms) {
      expect(arm).toContain('StatusCode::INTERNAL_SERVER_ERROR');
      expect(arm).toContain('(header::CACHE_CONTROL, "no-store")');
      expect(arm).toContain('(header::X_CONTENT_TYPE_OPTIONS, "nosniff")');
    }
    const pages = errorArms.reduce((code, arm) => code.replace(arm, ''), main);
    expect(pages).not.toMatch(/content-security-policy|CONTENT_SECURITY_POLICY|CACHE_CONTROL/i);
  });

  it('uses the current typed loader and no removed renderer or script APIs', () => {
    const main = stripComments(fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src/main.rs'), 'utf8'));
    expect(main).toContain('load_ir_modules::<Assets>');
    expect(main).toContain('pages.finalize()');
    expect(main.indexOf('pages.finalize()')).toBeLessThan(main.indexOf('tokio::net::TcpListener::bind'));
    expect(main).not.toMatch(/\b(?:try_render|render_page|render_page_with_nonce|load_ir_modules_strict|PageOutput|SlotData|RenderMode|config_script)\b/);
    expect(main).not.toMatch(/allow\(deprecated\)/);
  });

  it('installs a tracing subscriber and logs each render error through it', () => {
    // try_render returns a failure instead of serving an empty shell, and
    // forma-server logs none of it: the handler is where a failure is
    // counted, by code and route (DR-11). With no subscriber those lines, and
    // forma-server's own security events, are discarded.
    const main = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8'),
    );
    expect(main).toContain('tracing_subscriber::fmt::init()');
    expect(main).toMatch(/tracing::error!\(code = error\.code\(\), route = error\.route\(\)/);
  });

  it('builds with --strict, and leaves FORMA_STRICT working when the flag is absent', () => {
    // A new application starts under strict mode (v2 13.3): a construct the
    // compiler cannot render on the server fails the build with its code,
    // file and line (DR-1). @getforma/build reads no command-line flag, so
    // build.ts maps `--strict`; it adds `strict: true` only when the flag is
    // there, because `strict: false` would switch FORMA_STRICT=1 off too.
    // The scaffold gate builds a construct strict mode refuses ("minimal:
    // build:ssr is strict ...").
    const pkg = readJson(template, 'admin', 'package.json');
    const builds = Object.entries<string>(pkg.scripts).filter(([, command]) => /\bbuild\.ts\b/.test(command));
    expect(builds.length).toBeGreaterThan(0);
    for (const [script, command] of builds) {
      expect(command, `admin/package.json scripts.${script}`).toMatch(/\s--strict(\s|$)/);
    }
    const build = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'build.ts'), 'utf8'),
    );
    expect(build).toContain("...(process.argv.includes('--strict') ? { strict: true } : {}),");
    expect(build.match(/\bstrict:/g)?.length ?? 0).toBe(1);
  });

  it("registers no service worker, and routes /sw.js to forma-server's retiring worker", () => {
    // DR-25: the worker is an application's choice, off here. No page
    // registers one, and /sw.js serves the retiring worker, which deletes the
    // caches an earlier Forma worker left on the origin and unregisters. The
    // scaffold gate reads both from the running server.
    const main = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8'),
    );
    expect(main).toContain('sw::configure(sw::ServiceWorker::off())');
    expect(main).not.toMatch(/\.enabled\(\)/);
    expect(main).toContain('.route("/sw.js", get(sw::serve_sw::<Assets>))');
  });

  it('pins internal frontend dependencies to the coordinated source version', () => {
    const pkg = readJson(template, 'admin', 'package.json');
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of INTERNAL_NPM) if (all[name]) expect(all[name]).toBe(`=${SOURCE_VERSION}`);
    expect(all['@getforma/core']).toBe(`=${SOURCE_VERSION}`);
    expect(all['@getforma/build']).toBe(`=${SOURCE_VERSION}`);
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

describe('the published package', () => {
  it("carries every template's lockfiles in the npm tarball", () => {
    // The E2E gate scaffolds from this repository's tree, so it would not
    // notice a lockfile missing from the tarball users install; the
    // scaffolder would then quietly ship a project without it.
    const pack = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], REPO_ROOT, 120_000);
    expect(pack.status, pack.stderr).toBe(0);
    const files: string[] = JSON.parse(pack.stdout)[0].files.map((f: { path: string }) => f.path);
    for (const template of TEMPLATES) {
      expect(files).toContain(`templates/${template}/Cargo.lock`);
      expect(files).toContain(`templates/${template}/admin/package-lock.json`);
      expect(files).not.toContain('template-lock-seeds.json');
    }
  });
});

describe('minimal template', () => {
  it('compiles the actual scaffolded local page with one declared SERVER count and a Counter island', () => {
    const dir = mkTmpDir('forma-template-props-');
    try {
      const created = runCli(['declared-page', '--template', 'minimal'], dir);
      expect(created.status, created.stderr).toBe(0);
      const { result, diagnostics } = collectDiagnostics(() => generateRealIr(path.join(dir, 'declared-page/admin/src/home/app.tsx')));
      expect(diagnostics).toEqual([]);
      expect(result).not.toBeNull();
      expect(result!.islands.map(island => island.name)).toEqual(['Counter']);
      expect(getSlots(result!.binary).filter(slot => slot.source === 0).map(slot => [slot.name, slot.typeHint])).toEqual([['count', 3]]);
    } finally { rmrf(dir); }
  });
  it('declares the same count prop in its page and Rust handler with a distinct server seed', () => {
    const app = fs.readFileSync(path.join(TEMPLATES_DIR, 'minimal/admin/src/home/app.tsx'), 'utf8');
    const main = stripComments(fs.readFileSync(path.join(TEMPLATES_DIR, 'minimal/src/main.rs'), 'utf8'));
    expect(app).toMatch(/type HomeProps = \{ count: number \}/);
    expect(app).toContain('function Home(props: HomeProps)');
    expect(app).toContain('createSignal(props.count)');
    expect(app).toContain("mount(() => Home({ count: 0 }), '#app')");
    expect(main).toMatch(/#\[derive\(PageProps\)\]\s*struct HomeProps \{\s*count: u32,/);
    expect(main).toContain('home.render(&HomeProps { count: 7 }, &ctx)');
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
    expect(pages).toEqual(['home', 'about']);

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

  it('pins the compiler to the coordinated source version', () => {
    expect(readJson('minimal', 'admin', 'package.json').devDependencies['@getforma/compiler']).toBe(`=${SOURCE_VERSION}`);
  });

  it('binds declared props once, finalizes before listening, and never falls back after an SSR failure', () => {
    const main = stripComments(fs.readFileSync(path.join(TEMPLATES_DIR, 'minimal/src/main.rs'), 'utf8'));
    expect(main).toContain('load_ir_modules::<Assets>');
    expect(main).toContain('pages.bind::<HomeProps>("home")');
    expect(main).toContain('pages.bind::<AboutProps>("about")');
    expect(main).toContain('about.render(&AboutProps {}, &ctx)');
    expect(main.indexOf('pages.bind::<AboutProps>')).toBeLessThan(main.indexOf('pages.finalize()'));
    expect(main).toMatch(/Some\(RouteMode::Ssr\) => Some\(pages\.bind/);
    expect(main).toContain('Some(RouteMode::Browser) => None');
    expect(main).toContain('Some(home) => home.render(&HomeProps { count: 7 }, &ctx)');
    expect(main).toContain('None => render_browser_shell(');
    expect(main.indexOf('pages.finalize()')).toBeLessThan(main.indexOf('tokio::net::TcpListener::bind'));
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
  it('declares its entry browser-rendered (ssr: false), turns no SSR on, and offers no build:ssr script', () => {
    // Measured: with SSR on, the emitted IR renders to island placeholders and
    // 14 of the template's 16 Playwright tests fail. See the README. So the
    // browser route is a declaration in the build (L-13, DR-11), not the
    // absence of one.
    const build = stripComments(
      fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'admin', 'build.ts'), 'utf8'),
    );
    const entryPoints = /entryPoints:\s*\[([\s\S]*?)\]/.exec(build)?.[1] ?? '';
    const entries = [...entryPoints.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(entries.length, 'no entryPoints found in build.ts').toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry, 'an entry that does not declare ssr: false').toMatch(/\bssr:\s*false\b/);
    }
    expect(build.replace(entryPoints, ''), 'SSR turned on outside the entries').not.toMatch(/\bssr:/);
    expect(build).not.toContain('ssrEntryPoints');
    const pkg = readJson('dashboard', 'admin', 'package.json');
    expect(pkg.scripts['build:ssr']).toBeUndefined();
    // ...and no compiler dependency, since nothing emits IR here.
    expect(pkg.devDependencies['@getforma/compiler']).toBeUndefined();
  });

  it('validates and finalizes browser routes before serving explicit browser shells', () => {
    const main = stripComments(fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard/src/main.rs'), 'utf8'));
    expect(main).toContain('render_browser_shell(&config, &RenderCtx::new())');
    expect(main).toContain('load_ir_modules::<Assets>');
    expect(main).toContain('pages.finalize()');
    expect(main).not.toMatch(/\b(?:try_render|ir_module|SlotData)\b/);
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

  // FORMA-180 (the A2 audit's F18): a scaffolded dashboard's first `npm ci`
  // reports 4 high advisories, one chain, @tailwindcss/cli -> @parcel/watcher
  // 2.5.1 -> micromatch -> braces 3.0.3 (GHSA-vfj7-8cjw-p6xm, no fixed braces
  // on npm). The README explains it while it is true. The lockfile decides
  // whether it is true: @parcel/watcher 2.6.0 dropped micromatch, so once a
  // regenerated lockfile locks a watcher without it, the paragraph is stale
  // and this test demands its removal rather than letting it outlive the fact.
  it('tells the user about the braces advisory while its locked watcher still carries it', () => {
    const lock = readJson('dashboard', 'admin', 'package-lock.json');
    const watcher = lock.packages['node_modules/@parcel/watcher'];
    // Prose is wrapped at 80 columns; compare it unwrapped.
    const readme = fs
      .readFileSync(path.join(TEMPLATES_DIR, 'dashboard', 'README.md'), 'utf8')
      .replace(/\s+/g, ' ');
    const advisory = 'GHSA-vfj7-8cjw-p6xm';
    if (watcher && 'micromatch' in (watcher.dependencies ?? {})) {
      const cli = lock.packages['node_modules/@tailwindcss/cli'];
      const micromatch = lock.packages['node_modules/micromatch'];
      const braces = lock.packages['node_modules/braces'];
      expect(cli?.dependencies?.['@parcel/watcher'], 'the CLI is what pulls the watcher in').toBeDefined();
      expect(readme).toContain(advisory);
      // The chain as the lockfile resolves it, with the versions, in order.
      expect(readme).toContain(
        `\`@tailwindcss/cli\` ${cli.version} → \`@parcel/watcher\` ${watcher.version} → ` +
          `\`micromatch\` ${micromatch.version} → \`braces\` ${braces.version}`,
      );
    } else {
      expect(readme, 'the watcher no longer carries braces; drop the README paragraph').not.toContain(advisory);
    }
  });
});
