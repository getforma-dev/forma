import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TEMPLATES, validateProjectName } from '../src/scaffold';
import { E2E, PROJECT_NAMES, TEMPLATES_DIR, listFiles, mkTmpDir, rmrf, runCli, run, runRefusingServer, withServer } from './helpers';

/**
 * Runs the real CLI against a real temp directory.
 *
 * The structural half always runs. The build half — npm ci, the frontend
 * build, `cargo check` — runs when FORMA_SCAFFOLD_E2E=1, which is what turns a
 * template that cannot compile from a passing test into a failing one.
 */

const TEXT_EXTS = new Set(['.toml', '.lock', '.rs', '.ts', '.tsx', '.json', '.md', '.css', '.html', '.yml']);

function textFilesWithPlaceholders(dir: string): string[] {
  return listFiles(dir).filter((rel) => {
    if (!TEXT_EXTS.has(path.extname(rel))) return false;
    return /\{\{[A-Za-z_-]+\}\}/.test(fs.readFileSync(path.join(dir, rel), 'utf8'));
  });
}

describe('scaffolding', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkTmpDir();
  });

  afterAll(() => {
    rmrf(tmp);
  });

  describe.each(TEMPLATES)('%s', (template) => {
    const name = `probe-${template}`;
    let dest: string;

    beforeAll(() => {
      const res = runCli([name, '--template', template], tmp);
      expect(res.status, res.stderr || res.stdout).toBe(0);
      dest = path.join(tmp, name);
    });

    it('produces exactly the template tree, with _gitignore restored', () => {
      const expected = listFiles(path.join(TEMPLATES_DIR, template))
        .map((f) => (path.basename(f) === '_gitignore' ? f.replace(/_gitignore$/, '.gitignore') : f))
        .filter((f) => !f.startsWith('.git/'))
        .sort();
      const actual = listFiles(dest)
        .filter((f) => !f.startsWith('.git/'))
        .sort();
      expect(actual).toEqual(expected);
    });

    it('leaves no unreplaced placeholder anywhere', () => {
      expect(textFilesWithPlaceholders(dest)).toEqual([]);
    });

    it('names the crate after the project', () => {
      const toml = fs.readFileSync(path.join(dest, 'Cargo.toml'), 'utf8');
      expect(toml).toContain(`name = "${name}"`);
    });

    it("puts the project's own Cargo.lock entry where cargo sorts it", () => {
      // The template's entry carries the placeholder, which sorts last; once
      // renamed it must move, or the first plain `cargo run` rewrites the
      // lockfile of a project nobody has touched yet. Cargo sorts by name,
      // bytewise.
      const lock = fs.readFileSync(path.join(dest, 'Cargo.lock'), 'utf8').replace(/\r\n/g, '\n');
      const names = [...lock.matchAll(/^name = "([^"]+)"$/gm)].map((m) => m[1]!);
      expect(names).toContain(name);
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    });

    it('tells an npm user to install with npm ci, which leaves the shipped lockfile as it is', () => {
      // `npm install` may rewrite a lockfile it would have written
      // differently: npm 10 drops `"peer": true` flags from the dashboard's,
      // npm 11 drops two bundled entries. `npm ci` never writes it.
      const probe = `npmci-${template}`;
      const res = runCli([probe, '--template', template], tmp, {
        npm_config_user_agent: 'npm/11.6.2 node/v22.21.0 linux x64 workspaces/false',
      });
      expect(res.status, res.stderr).toBe(0);
      // The CLI colours each command word, which would split "npm install".
      const out = res.stdout.replace(/\x1b\[[0-9;]*m/g, '');
      expect(out).toMatch(/^\s*npm ci$/m);
      expect(out).not.toMatch(/\bnpm install\b/);
      // It scaffolds a second project, which took up to 2,297 ms on the
      // Windows scaffold leg: 7 s is about 3x that, where vitest's 5 s default
      // was barely 2x (FORMA-179).
    }, 7_000);

    it('writes a .gitignore and no _gitignore', () => {
      expect(fs.existsSync(path.join(dest, '.gitignore'))).toBe(true);
      expect(fs.existsSync(path.join(dest, '_gitignore'))).toBe(false);
    });

    it('refuses to scaffold over the directory it just created', () => {
      const res = runCli([name, '--template', template], tmp);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('already exists');
    });
  });

  describe('input validation', () => {
    const CHARSET = 'use only lowercase letters, digits, "-" and "_"';
    it.each([
      ['../escape', 'path traversal', CHARSET],
      ['..', 'parent directory', CHARSET],
      ['a/b', 'forward slash', CHARSET],
      ['a\\b', 'backslash', CHARSET],
      ['/abs', 'absolute path', CHARSET],
      ['C:tricky', 'drive-relative path', CHARSET],
      ['My-App', 'upper case', CHARSET],
      ['0app', 'leading digit', 'cargo refuses a package name that starts with a digit'],
      ['-leading', 'leading hyphen', 'cargo refuses a package name that starts with "-"'],
      ['_leading', 'leading underscore', 'npm refuses a package name that starts with "_"'],
      ['fn', 'Rust keyword', 'cargo refuses a Rust keyword as a package name'],
      ['build', "cargo's build directory", 'cargo refuses one of its build directory names'],
      ['test', "Rust's test library", 'cargo refuses "test" as a package name'],
      ['con', 'Windows device name', 'Windows refuses a device name'],
      ['x'.repeat(65), 'over-long name', 'crates.io refuses a package name longer than 64 characters'],
    ])('refuses %s (%s) before writing anything, naming the rule', (bad, _why, rule) => {
      // Checking the resolved destination is not enough for `..`, whose
      // resolved path exists no matter what the CLI does — assert that the
      // whole working directory is untouched instead.
      const before = listFiles(tmp);
      const res = runCli([bad, '--template', 'minimal'], tmp);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(rule);
      expect(listFiles(tmp)).toEqual(before);
    });

    it('rejects an unknown template without touching the filesystem', () => {
      const before = listFiles(tmp);
      const res = runCli(['ok-name', '--template', '../../etc'], tmp);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Invalid template');
      expect(listFiles(tmp)).toEqual(before);
    });

    it('rejects --template with no value', () => {
      const res = runCli(['ok-name', '--template'], tmp);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('needs a value');
    });

    it('rejects --template followed by another flag', () => {
      const res = runCli(['ok-name', '--template', '--dry-run'], tmp);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('needs a value');
    });

    it('accepts a project name that happens to equal the template name', () => {
      const res = runCli(['minimal', '--template', 'minimal', '--dry-run'], tmp);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Would create');
      expect(res.stdout).toContain('minimal');
    });

    it('--dry-run creates nothing', () => {
      const before = listFiles(tmp);
      const res = runCli(['dry-probe', '--template', 'dashboard', '--dry-run'], tmp);
      expect(res.status).toBe(0);
      expect(fs.existsSync(path.join(tmp, 'dry-probe'))).toBe(false);
      expect(listFiles(tmp)).toEqual(before);
    });

    it('refuses to scaffold onto a dangling symlink', () => {
      const link = path.join(tmp, 'dangling');
      try {
        fs.symlinkSync(path.join(tmp, 'nowhere-at-all'), link, 'file');
      } catch {
        return; // Windows without Developer Mode
      }
      try {
        // existsSync() reports false here, so the old check waved this
        // through and cpSync would have written through the link.
        const res = runCli(['dangling', '--template', 'minimal'], tmp);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('already exists');
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      } finally {
        fs.rmSync(link, { force: true });
      }
    });

    it('--version prints the package version', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(TEMPLATES_DIR, '..', 'package.json'), 'utf8'),
      );
      const res = runCli(['--version'], tmp);
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe(pkg.version);
    });
  });
});

// ── The gate: does what we ship actually build? ────────────────────────

/**
 * A template's page routes: those whose handler renders a page, through
 * `try_render` or `render_browser_shell`, read from its main.rs, so a page
 * added to a template is covered without editing the tests.
 */
function pageRoutes(main: string): string[] {
  const rendersPage = (handler: string) =>
    /\b(?:try_render|render_browser_shell)\(/.test(new RegExp(`async fn ${handler}\\b[\\s\\S]*?\\n}`).exec(main)?.[0] ?? '');
  return [...main.matchAll(/\.route\("([^"]+)",\s*get\((\w+)\)\)/g)]
    .filter((m) => rendersPage(m[2]!))
    .map((m) => m[1]!);
}

describe.runIf(E2E)('scaffolded projects build (FORMA_SCAFFOLD_E2E=1)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkTmpDir('forma-e2e-');
  });

  afterAll(() => {
    rmrf(tmp);
  });

  it.each(TEMPLATES)('%s: npm ci, frontend build, cargo check --locked', (template) => {
    const name = `e2e-${template}`;
    const scaffold = runCli([name, '--template', template], tmp);
    expect(scaffold.status, scaffold.stderr).toBe(0);
    const dest = path.join(tmp, name);
    const admin = path.join(dest, 'admin');
    const npmLock = fs.readFileSync(path.join(admin, 'package-lock.json'));
    const cargoLock = fs.readFileSync(path.join(dest, 'Cargo.lock'));

    // `npm ci` and `--locked` install exactly the template's lockfiles and
    // fail if either disagrees with its manifest (DR-32).
    const install = run('npm', ['ci', '--no-audit', '--no-fund'], admin);
    expect(install.status, install.stderr).toBe(0);

    // SR2: every package the lockfile installed carries the npm registry's
    // signature, checked against the registry's published keys, and every
    // attestation it carries verifies.
    const signatures = run('npm', ['audit', 'signatures'], admin);
    expect(signatures.status, signatures.stdout + signatures.stderr).toBe(0);

    // One esbuild in the installed tree, shared by the template, @getforma/build
    // and tsx. `npm query` lists every physical copy (FORMA-165).
    const esbuild = run('npm', ['query', '#esbuild'], admin);
    expect(esbuild.status, esbuild.stderr).toBe(0);
    const esbuildCopies = (JSON.parse(esbuild.stdout) as Array<{ location: string; version: string }>).map(
      (node) => `${node.location.replace(/\\/g, '/')}@${node.version}`,
    );
    expect(esbuildCopies, 'npm installed more than one esbuild').toHaveLength(1);
    expect(esbuildCopies[0]).toMatch(/^node_modules\/esbuild@/);

    const build = run('npm', ['run', 'build'], admin);
    expect(build.status, build.stdout + build.stderr).toBe(0);

    // rust-embed needs admin/dist to exist at compile time, which the frontend
    // build above is what creates.
    expect(fs.existsSync(path.join(admin, 'dist', 'manifest.json'))).toBe(true);

    const check = run('cargo', ['check', '--locked'], dest);
    expect(check.status, check.stderr).toBe(0);
    // The template calls no API its forma-server deprecates, so its move to
    // 3.0.0 is one commit (v2 13.3); the compiler is the judge.
    expect(check.stderr, 'the template uses an API forma-server deprecates').not.toMatch(/use of deprecated/);

    // A plain cargo command, as a user's first `cargo run`, rewrites a
    // lockfile it would have written differently, even only in its order.
    const tree = run('cargo', ['tree', '--offline', '--depth', '1'], dest);
    expect(tree.status, tree.stderr).toBe(0);
    expect(fs.readFileSync(path.join(dest, 'Cargo.lock')).equals(cargoLock), 'cargo rewrote Cargo.lock').toBe(true);
    expect(fs.readFileSync(path.join(admin, 'package-lock.json')).equals(npmLock), 'npm rewrote package-lock.json').toBe(true);
  }, 900_000);

  it('minimal: build:ssr emits real IR, not a placeholder', async () => {
    const name = 'e2e-ssr';
    expect(runCli([name, '--template', 'minimal'], tmp).status).toBe(0);
    const dest = path.join(tmp, name);
    const admin = path.join(dest, 'admin');

    expect(run('npm', ['ci', '--no-audit', '--no-fund'], admin).status).toBe(0);

    const build = run('npm', ['run', 'build:ssr'], admin);
    const out = build.stdout + build.stderr;
    expect(build.status, out).toBe(0);

    // The compiler prints "(placeholder)" when it could not walk the entry's
    // tree — that is the failure this template existed in for months, and the
    // server degrades to a client-mount shell without saying so.
    expect(out).toContain('IR emitted (real)');
    expect(out).not.toContain('placeholder');
    // Any island in the emitted IR is a subtree the compiler could NOT
    // translate, and an anonymous one cannot hydrate.
    expect(out).toContain('0 islands');

    const manifest = JSON.parse(
      fs.readFileSync(path.join(admin, 'dist', 'manifest.json'), 'utf8'),
    );
    const irFile = manifest.routes['/'].ir;
    expect(irFile, 'route / has no ir entry in the manifest').toBeTruthy();
    const irBytes = fs.statSync(path.join(admin, 'dist', irFile)).size;
    // A placeholder is ~121 bytes; a walked tree for this page is ~450.
    expect(irBytes).toBeGreaterThan(300);

    // ...and the server actually serves it. Emitting IR is not the claim; the
    // claim is that the HTML contains the page. render_page silently falls
    // back to Phase 1 whenever `ir_module` or `slots` is None, which is the
    // shape the dashboard was stuck in, so this has to be checked over HTTP.
    expect(run('cargo', ['build', '--locked'], dest).status).toBe(0);
    await withServer(dest, name, (body) => {
      expect(body).toContain('data-forma-ssr');
      expect(body).toContain(`<h1>${name}</h1>`);
      expect(body).toContain('class="lede"');
      expect(body).not.toContain('<div id="app"></div>');
    });
  }, 900_000);

  it('minimal: a corrupt module stops the server before it binds, and a failed render answers 500, with neither its error nor a shell', async () => {
    // DR-11's two guarantees, read from the running server rather than from
    // main.rs: a module the build declared that is corrupt is a failed
    // deploy, refused at start; and a page that fails to render is answered
    // by the handler as an error, never replaced by the Phase 1 shell that
    // render_page used to substitute.
    const name = 'e2e-dr11';
    expect(runCli([name, '--template', 'minimal'], tmp).status).toBe(0);
    const dest = path.join(tmp, name);
    const admin = path.join(dest, 'admin');
    expect(run('npm', ['ci', '--no-audit', '--no-fund'], admin).status).toBe(0);
    const build = run('npm', ['run', 'build:ssr'], admin);
    expect(build.status, build.stdout + build.stderr).toBe(0);
    const cargo = run('cargo', ['build', '--locked'], dest);
    expect(cargo.status, cargo.stderr).toBe(0);

    // A truncated module: the server exits, naming the route and the code,
    // and never binds its port.
    const manifest = JSON.parse(fs.readFileSync(path.join(admin, 'dist', 'manifest.json'), 'utf8'));
    const irPath = path.join(admin, 'dist', manifest.routes['/'].ir);
    const ir = fs.readFileSync(irPath);
    fs.writeFileSync(irPath, ir.subarray(0, 40));
    const refused = await runRefusingServer(dest, name);
    expect(refused.accepted, `the server bound 127.0.0.1:3000 with a corrupt module:\n${refused.output}`).toBe(false);
    expect(refused.code, `the server was still running with a corrupt module:\n${refused.output}`).not.toBeNull();
    expect(refused.code, refused.output).not.toBe(0);
    expect(refused.output).toContain('LOAD-');
    expect(refused.output).toContain('route /');
    fs.writeFileSync(irPath, ir);

    // A render that fails: a one-byte output budget makes try_render return
    // RENDER-301 for `/`.
    const mainPath = path.join(dest, 'src', 'main.rs');
    const main = fs.readFileSync(mainPath, 'utf8');
    const failing = main.replace(
      'let ctx = RenderCtx::new();',
      'let ctx = RenderCtx::new().with_limits(forma_server::WalkLimits { max_output_bytes: 1, ..Default::default() });',
    );
    expect(failing, 'main.rs has no `let ctx = RenderCtx::new();` to give a budget').not.toBe(main);
    fs.writeFileSync(mainPath, failing);
    const rebuild = run('cargo', ['build', '--locked'], dest);
    expect(rebuild.status, rebuild.stderr).toBe(0);

    await withServer(dest, name, async (body, res, _get, output) => {
      // The handler's own 500, never cached or sniffed, carrying neither the
      // error (which belongs in the log) nor an empty shell.
      expect(res.status, body).toBe(500);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(body).not.toContain('RENDER-');
      expect(body).not.toContain('<div id="app"');
      // ...and the log line that counts it, by code and route.
      for (let wait = 0; wait < 50 && !output().includes('RENDER-301'); wait++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(output()).toContain('code="RENDER-301"');
      expect(output()).toContain('route="/"');
    });
  }, 900_000);

  it('minimal: build:ssr is strict: a construct the server cannot render fails the build, naming its code, file and line', () => {
    // A `.map()` child is BUILD-701: the server renders an empty island and
    // the rows never appear after activation. The template's scripts pass
    // --strict, so its SSR build refuses it; build.ts maps the flag and adds
    // nothing without it, so the same build without the flag only warns, and
    // FORMA_STRICT=1 still turns strict mode on.
    const name = 'e2e-strict';
    expect(runCli([name, '--template', 'minimal'], tmp).status).toBe(0);
    const admin = path.join(tmp, name, 'admin');
    expect(run('npm', ['ci', '--no-audit', '--no-fund'], admin).status).toBe(0);

    const appPath = path.join(admin, 'src', 'home', 'app.tsx');
    const app = fs.readFileSync(appPath, 'utf8');
    const probe = app.replace(
      '<p class="actions">',
      '<ul class="probe">{["a", "b"].map((i) => <li>{i}</li>)}</ul>\n      <p class="actions">',
    );
    expect(probe, 'app.tsx has no <p class="actions"> to put the probe before').not.toBe(app);
    fs.writeFileSync(appPath, probe);
    const at = /src[\\/]home[\\/]app\.tsx:\d+:\d+/;

    const strict = run('npm', ['run', 'build:ssr'], admin);
    const strictOut = strict.stdout + strict.stderr;
    expect(strict.status, strictOut).not.toBe(0);
    expect(strictOut).toContain('strict mode');
    expect(strictOut).toContain('BUILD-701');
    expect(strictOut).toMatch(at);

    const lenient = run('npx', ['tsx', 'build.ts', '--ssr'], admin);
    const lenientOut = lenient.stdout + lenient.stderr;
    expect(lenient.status, lenientOut).toBe(0);
    expect(lenientOut).toContain('BUILD-701');

    const fromEnv = run('npx', ['tsx', 'build.ts', '--ssr'], admin, 900_000, { FORMA_STRICT: '1' });
    const fromEnvOut = fromEnv.stdout + fromEnv.stderr;
    expect(fromEnv.status, fromEnvOut).not.toBe(0);
    expect(fromEnvOut).toContain('BUILD-701');
  }, 900_000);

  it('dashboard: serves each page as its browser shell, by declaration (ssr: false)', async () => {
    const name = 'e2e-phase1';
    expect(runCli([name, '--template', 'dashboard'], tmp).status).toBe(0);
    const dest = path.join(tmp, name);
    const admin = path.join(dest, 'admin');

    expect(run('npm', ['ci', '--no-audit', '--no-fund'], admin).status).toBe(0);
    expect(run('npm', ['run', 'build'], admin).status).toBe(0);
    expect(run('cargo', ['build', '--locked'], dest).status).toBe(0);

    // The entry declares `ssr: false`, so the build emits no module for any
    // route; the server never walks one, and its pages are served by
    // render_browser_shell, by declaration rather than as a fallback (L-13).
    const manifest = JSON.parse(fs.readFileSync(path.join(admin, 'dist', 'manifest.json'), 'utf8'));
    const withModules = Object.entries<{ ir?: string }>(manifest.routes).filter(([, r]) => r.ir).map(([route]) => route);
    expect(withModules, 'a route with an IR module').toEqual([]);
    const pages = pageRoutes(fs.readFileSync(path.join(dest, 'src', 'main.rs'), 'utf8'));
    expect(pages).toHaveLength(5);

    await withServer(dest, name, async (_body, _res, get) => {
      for (const route of pages) {
        const res = await get(route);
        const body = await res.text();
        expect(res.status, route).toBe(200);
        expect(body, route).toContain('<div id="app"></div>');
        expect(body, route).not.toContain('data-forma-ssr');
        // The CSP has to carry a nonce, and the same nonce has to be on the
        // script tag the shell carries, or the page cannot run at all.
        const csp = res.headers.get('content-security-policy') ?? '';
        const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
        expect(nonce, `${route}: no nonce in CSP: ${csp}`).toBeTruthy();
        // Assert per-directive, not with a substring sweep over the whole
        // header. forma-server 0.2.0 carries `style-src-attr 'unsafe-inline'`
        // deliberately — that directive governs `style=""` ATTRIBUTES only, so
        // it lets server-rendered style attributes through while `style-src`
        // still refuses inline <style> blocks. A blanket not-toContain cannot
        // tell those apart and fails on a header that got stricter, not looser.
        const directive = (name: string) =>
          csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';
        expect(directive('script-src'), `script-src: ${csp}`).not.toContain('unsafe-inline');
        expect(directive('style-src'), `style-src: ${csp}`).not.toContain('unsafe-inline');
        expect(directive('default-src')).toContain("'none'");
        expect(body, route).toContain(`nonce="${nonce}"`);
      }
    });
  }, 900_000);
  /**
   * The locked crates whose own `rust-version` is above the project's.
   * Cargo.lock pins versions but does not record what Rust each needs; the
   * crates' manifests do, and `cargo metadata` reads them.
   */
  function cratesAboveTheFloor(dest: string): { floor: string; offenders: string[] } {
    const toml = fs.readFileSync(path.join(dest, 'Cargo.toml'), 'utf8').replace(/\r\n/g, '\n');
    const floor = /^rust-version = "([^"]+)"/m.exec(toml)?.[1];
    expect(floor, 'the template declares no rust-version').toBeTruthy();
    const meta = run('cargo', ['metadata', '--locked', '--format-version', '1'], dest);
    expect(meta.status, meta.stderr).toBe(0);
    const parts = (v: string) => v.split('.').map(Number);
    const above = (v: string) => {
      const [a, b] = [parts(v), parts(floor!)];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
      }
      return false;
    };
    const packages: Array<{ name: string; version: string; rust_version: string | null }> =
      JSON.parse(meta.stdout).packages;
    const offenders = packages
      .filter((p) => p.rust_version && above(p.rust_version))
      .map((p) => `${p.name}@${p.version} needs ${p.rust_version}`);
    return { floor: floor!, offenders };
  }

  it.each(TEMPLATES)('%s: no locked crate needs a newer Rust than the template declares', (template) => {
    // A lockfile resolved without the MSRV-aware resolver silently raised the
    // floor to 1.88 (sha2 0.11.1), above the 1.85 that forma-server declares
    // (FORMA-015).
    const name = `e2e-msrv-${template}`;
    expect(runCli([name, '--template', template], tmp).status).toBe(0);
    const { floor, offenders } = cratesAboveTheFloor(path.join(tmp, name));
    expect(offenders, `locked above the template's rust-version ${floor}`).toEqual([]);
  }, 900_000);

  it.each(TEMPLATES)("%s: a user's own cargo update keeps every crate within the template's rust-version", (template) => {
    // The shipped lockfile holds the floor; `resolver = "3"` makes cargo
    // hold it through the user's updates too, on any cargo from 1.84. Without
    // it, `cargo update` moves sha2 0.11.0 -> 0.11.1, which needs Rust 1.88.
    const name = `e2e-update-${template}`;
    expect(runCli([name, '--template', template], tmp).status).toBe(0);
    const dest = path.join(tmp, name);
    const update = run('cargo', ['update'], dest);
    expect(update.status, update.stderr).toBe(0);
    const { floor, offenders } = cratesAboveTheFloor(dest);
    expect(offenders, `cargo update locked above the template's rust-version ${floor}`).toEqual([]);
  }, 900_000);

  it.each([
    ['minimal', 'tracing'],
    ['dashboard', 'serde'],
  ])(
    '%s scaffolded as %s, a crate in its own graph: cargo --locked accepts the lockfile and plain cargo leaves it',
    (template, name) => {
      // With two packages of one name, cargo writes every reference to the
      // registry one as "name version", so the scaffolder has to as well.
      expect(runCli([name, '--template', template], tmp).status).toBe(0);
      const dest = path.join(tmp, name);
      const shipped = fs.readFileSync(path.join(dest, 'Cargo.lock'));

      const locked = run('cargo', ['metadata', '--locked', '--format-version', '1'], dest);
      expect(locked.status, locked.stderr).toBe(0);
      const plain = run('cargo', ['tree', '--offline', '--depth', '1'], dest);
      expect(plain.status, plain.stderr).toBe(0);
      expect(fs.readFileSync(path.join(dest, 'Cargo.lock')).equals(shipped), 'cargo rewrote Cargo.lock').toBe(true);
    },
    900_000,
  );

  it('minimal: build:ssr reads ssrEntryPoints by page name', () => {
    // @getforma/build looks an SSR entry up by page name and silently falls
    // back to the browser entry when the key does not match, so a template
    // whose SSR entry IS its browser entry cannot tell a read key from an
    // ignored one. Point the template's own key at a different file and check
    // that the IR came from that file.
    const name = 'e2e-ssr-key';
    expect(runCli([name, '--template', 'minimal'], tmp).status).toBe(0);
    const admin = path.join(tmp, name, 'admin');
    expect(run('npm', ['ci', '--no-audit', '--no-fund'], admin).status).toBe(0);

    const app = fs.readFileSync(path.join(admin, 'src', 'home', 'app.tsx'), 'utf8');
    const probe = app.replace(`<h1>${name}</h1>`, '<h1>ssr-entry-probe</h1>');
    expect(probe).not.toBe(app);
    fs.writeFileSync(path.join(admin, 'src', 'home', 'ssr-probe.tsx'), probe);

    const buildTs = path.join(admin, 'build.ts');
    const config = fs.readFileSync(buildTs, 'utf8');
    const repointed = config.replace(
      /(ssrEntryPoints:\s*\{[^}]*?)'src\/home\/app\.tsx'/,
      "$1'src/home/ssr-probe.tsx'",
    );
    expect(repointed, 'build.ts has no ssrEntryPoints entry for src/home/app.tsx').not.toBe(config);
    fs.writeFileSync(buildTs, repointed);

    const build = run('npm', ['run', 'build:ssr'], admin);
    expect(build.status, build.stdout + build.stderr).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(admin, 'dist', 'manifest.json'), 'utf8'));
    const ir = fs.readFileSync(path.join(admin, 'dist', manifest.routes['/'].ir));
    expect(ir.includes('ssr-entry-probe'), 'the IR was not built from the ssrEntryPoints file').toBe(true);
    expect(ir.includes(name), 'the IR was built from the browser entry').toBe(false);
  }, 900_000);

  it.each(TEMPLATES)(
    '%s: every page answers no-store with a fresh nonce per fetch, and registers no service worker',
    async (template) => {
      // SR6. A page's nonce is drawn per request and is only secret while no
      // two responses share it: a cached page replays one nonce to every
      // visitor. So every page route answers `no-store`, and two fetches of
      // the same page carry two nonces, each matching its own HTML (DR-17).
      // Checked after every build the template offers, so the minimal
      // template's page is read both as try_render's server-rendered page
      // (`build:ssr`) and as its browser shell (`build`).
      const name = `e2e-headers-${template}`;
      expect(runCli([name, '--template', template], tmp).status).toBe(0);
      const dest = path.join(tmp, name);
      const admin = path.join(dest, 'admin');
      expect(run('npm', ['ci', '--no-audit', '--no-fund'], admin).status).toBe(0);

      const pages = pageRoutes(fs.readFileSync(path.join(dest, 'src', 'main.rs'), 'utf8'));
      expect(pages.length, 'no page route found in main.rs').toBeGreaterThan(0);
      if (template === 'dashboard') expect(pages).toHaveLength(5);

      const scripts = JSON.parse(fs.readFileSync(path.join(admin, 'package.json'), 'utf8')).scripts;
      const builds = ['build', 'build:ssr'].filter((script) => scripts[script]);
      const nonces: string[] = [];
      for (const script of builds) {
        const build = run('npm', ['run', script], admin);
        expect(build.status, build.stdout + build.stderr).toBe(0);
        const cargo = run('cargo', ['build', '--locked'], dest);
        expect(cargo.status, cargo.stderr).toBe(0);
        const root = script === 'build:ssr' ? '<div id="app" data-forma-ssr>' : '<div id="app"></div>';

        await withServer(dest, name, async (_body, _res, get) => {
          for (const route of pages) {
            for (let fetchNo = 1; fetchNo <= 2; fetchNo++) {
              const res = await get(route);
              const where = `${script}: ${route}, fetch ${fetchNo}`;
              expect(res.status, where).toBe(200);
              expect(res.headers.get('cache-control'), where).toBe('no-store');
              expect(res.headers.get('content-type'), where).toMatch(/^text\/html/);
              const csp = res.headers.get('content-security-policy') ?? '';
              const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
              expect(nonce, `${where}: no nonce in CSP: ${csp}`).toBeTruthy();
              const html = await res.text();
              expect(html, `${where}: the HTML does not carry its own nonce`).toContain(`nonce="${nonce}"`);
              expect(html, `${where}: rendered by the wrong path`).toContain(root);
              // DR-25: the worker is off, so no page registers one.
              expect(html, `${where}: the page registers a service worker`).not.toMatch(/serviceWorker\.register/);
              nonces.push(nonce!);
            }
          }

          // ...and /sw.js is forma-server's retiring worker, not the one the
          // build embedded: it deletes Forma's caches and unregisters, and
          // answers no request.
          const sw = await get('/sw.js');
          expect(sw.status).toBe(200);
          expect(sw.headers.get('content-type')).toMatch(/javascript/);
          const worker = await sw.text();
          expect(worker).toContain('registration.unregister()');
          expect(worker).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
          // @getforma/build writes a worker into every production build, so
          // there is always one the server must not be serving.
          const built = path.join(admin, 'dist', 'sw.js');
          expect(fs.existsSync(built), 'the build embedded no sw.js').toBe(true);
          expect(worker).not.toBe(fs.readFileSync(built, 'utf8'));
        });
      }
      expect(new Set(nonces).size, `a nonce repeated across fetches: ${nonces.join(' ')}`).toBe(nonces.length);
    },
    900_000,
  );

  it('cargo new accepts every project name the scaffolder accepts, and refuses every name it says cargo refuses', () => {
    // validateProjectName restates cargo's package-name rules; this holds the
    // restatement to cargo itself. `cargo new` applies them all (the manifest's
    // and its own, for a package with a binary) and needs no network.
    const dir = path.join(tmp, 'cargo-names');
    fs.mkdirSync(dir);
    let asked = 0;
    let askedRefused = 0;
    const disagreements = PROJECT_NAMES.flatMap((name, i) => {
      const reason = validateProjectName(name);
      if (reason !== null && !reason.includes('cargo refuses')) return [];
      asked++;
      if (reason !== null) askedRefused++;
      const res = run('cargo', ['new', '--vcs', 'none', '--bin', `--name=${name}`, `p${i}`], dir);
      const cargoError = /^error: .*$/m.exec(res.stderr)?.[0] ?? res.stderr.trim();
      if (reason === null && res.status !== 0) return [`${name}: accepted here, cargo new refuses it: ${cargoError}`];
      if (reason !== null && res.status === 0) return [`${name}: "${reason}", cargo new accepts it`];
      return [];
    });
    expect(disagreements).toEqual([]);
    // Both halves were put to cargo.
    expect(askedRefused).toBeGreaterThan(0);
    expect(asked - askedRefused).toBeGreaterThan(0);
  }, 300_000);
});
