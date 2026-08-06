import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TEMPLATES } from '../src/scaffold';
import { E2E, TEMPLATES_DIR, listFiles, mkTmpDir, rmrf, runCli, run, withServer } from './helpers';

/**
 * Runs the real CLI against a real temp directory.
 *
 * The structural half always runs. The build half — npm install, the frontend
 * build, `cargo check` — runs when FORMA_SCAFFOLD_E2E=1, which is what turns a
 * template that cannot compile from a passing test into a failing one.
 */

const TEXT_EXTS = new Set(['.toml', '.rs', '.ts', '.tsx', '.json', '.md', '.css', '.html', '.yml']);

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
    it.each([
      ['../escape', 'path traversal'],
      ['..', 'parent directory'],
      ['a/b', 'forward slash'],
      ['a\\b', 'backslash'],
      ['/abs', 'absolute path'],
      ['C:tricky', 'drive-relative path'],
      ['My-App', 'upper case'],
      ['-leading', 'leading hyphen'],
      ['con', 'Windows device name'],
      ['x'.repeat(65), 'over-long name'],
    ])('rejects %s (%s)', (bad) => {
      // Checking the resolved destination is not enough for `..`, whose
      // resolved path exists no matter what the CLI does — assert that the
      // whole working directory is untouched instead.
      const before = listFiles(tmp);
      const res = runCli([bad, '--template', 'minimal'], tmp);
      expect(res.status).toBe(1);
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

describe.runIf(E2E)('scaffolded projects build (FORMA_SCAFFOLD_E2E=1)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkTmpDir('forma-e2e-');
  });

  afterAll(() => {
    rmrf(tmp);
  });

  it.each(TEMPLATES)('%s: npm install, frontend build, cargo check', (template) => {
    const name = `e2e-${template}`;
    const scaffold = runCli([name, '--template', template], tmp);
    expect(scaffold.status, scaffold.stderr).toBe(0);
    const dest = path.join(tmp, name);
    const admin = path.join(dest, 'admin');

    const install = run('npm', ['install', '--no-audit', '--no-fund'], admin);
    expect(install.status, install.stderr).toBe(0);

    const build = run('npm', ['run', 'build'], admin);
    expect(build.status, build.stdout + build.stderr).toBe(0);

    // rust-embed needs admin/dist to exist at compile time, which the frontend
    // build above is what creates.
    expect(fs.existsSync(path.join(admin, 'dist', 'manifest.json'))).toBe(true);

    const check = run('cargo', ['check'], dest);
    expect(check.status, check.stderr).toBe(0);
  }, 900_000);

  it('minimal: build:ssr emits real IR, not a placeholder', async () => {
    const name = 'e2e-ssr';
    expect(runCli([name, '--template', 'minimal'], tmp).status).toBe(0);
    const dest = path.join(tmp, name);
    const admin = path.join(dest, 'admin');

    expect(run('npm', ['install', '--no-audit', '--no-fund'], admin).status).toBe(0);

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
    expect(run('cargo', ['build'], dest).status).toBe(0);
    await withServer(dest, name, (body) => {
      expect(body).toContain('data-forma-ssr');
      expect(body).toContain(`<h1>${name}</h1>`);
      expect(body).toContain('class="lede"');
      expect(body).not.toContain('<div id="app"></div>');
    });
  }, 900_000);

  it('dashboard: serves a Phase 1 shell, deliberately', async () => {
    const name = 'e2e-phase1';
    expect(runCli([name, '--template', 'dashboard'], tmp).status).toBe(0);
    const dest = path.join(tmp, name);
    const admin = path.join(dest, 'admin');

    expect(run('npm', ['install', '--no-audit', '--no-fund'], admin).status).toBe(0);
    expect(run('npm', ['run', 'build'], admin).status).toBe(0);
    expect(run('cargo', ['build'], dest).status).toBe(0);

    await withServer(dest, name, (body, res) => {
      expect(body).toContain('<div id="app"></div>');
      expect(body).not.toContain('data-forma-ssr');
      // The CSP has to carry a nonce, and the same nonce has to be on the
      // script tag render_page emitted, or the page cannot run at all.
      const csp = res.headers.get('content-security-policy') ?? '';
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce, `no nonce in CSP: ${csp}`).toBeTruthy();
      expect(csp).not.toContain('unsafe-inline');
      expect(body).toContain(`nonce="${nonce}"`);
    });
  }, 900_000);
});
