import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import {
  NEVER_COPY,
  placeCargoLockRoot,
  replacePlaceholders,
  restoreGitignores,
  validateProjectName,
} from '../src/scaffold';
import { PROJECT_NAMES, REPO_ROOT, mkTmpDir, rmrf } from './helpers';

/** Symlink creation needs Developer Mode or elevation on Windows. */
function canSymlink(dir: string): boolean {
  const target = path.join(dir, '.symlink-probe-target');
  const link = path.join(dir, '.symlink-probe-link');
  try {
    fs.writeFileSync(target, 'x');
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(target, { force: true });
  }
}

/** npm's own package-name validator: the rules `npm init` and the registry apply. */
const validateNpmName = createRequire(import.meta.url)('validate-npm-package-name') as (
  name: string,
) => { validForNewPackages: boolean };

describe('validateProjectName', () => {
  it.each(['app', 'my-app', 'my_app', 'a', 'x9', 'app0', 'a-0', 'std', 'x'.repeat(64)])(
    'accepts %s',
    (name) => {
      expect(validateProjectName(name)).toBeNull();
    },
  );

  const CHARSET = 'use only lowercase letters, digits, "-" and "_"';
  const KEYWORD = 'cargo refuses a Rust keyword as a package name';
  const BUILD_DIR = 'cargo refuses one of its build directory names';
  const NODE_CORE = 'npm refuses a Node.js core module name for a new package';
  const WINDOWS = 'Windows refuses a device name';

  it.each([
    ['', 'Project name required'],
    ['x'.repeat(65), 'crates.io refuses a package name longer than 64 characters'],
    ['My-App', CHARSET],
    ['C:tricky', CHARSET],
    ['..', CHARSET],
    ['../escape', CHARSET],
    ['a/b', CHARSET],
    ['a\\b', CHARSET],
    ['/abs', CHARSET],
    ['.hidden', CHARSET],
    ['has space', CHARSET],
    ['café', CHARSET],
    ['0app', 'cargo refuses a package name that starts with a digit'],
    ['9', 'cargo refuses a package name that starts with a digit'],
    ['-leading', 'cargo refuses a package name that starts with "-"'],
    ['_leading', 'npm refuses a package name that starts with "_"'],
    ['fn', KEYWORD],
    ['self', KEYWORD],
    ['type', KEYWORD],
    ['build', BUILD_DIR],
    ['deps', BUILD_DIR],
    ['examples', BUILD_DIR],
    ['incremental', BUILD_DIR],
    ['test', 'cargo refuses "test" as a package name'],
    ['node_modules', 'npm refuses "node_modules" as a package name'],
    ['http', NODE_CORE],
    ['fs', NODE_CORE],
    ['con', WINDOWS],
    ['lpt1', WINDOWS],
  ])('refuses %j, naming the rule: %s', (name, rule) => {
    const reason = validateProjectName(name);
    expect(reason).toContain(rule);
    // The message says which name it refused.
    if (name) expect(reason).toContain(`"${name}"`);
  });

  it("agrees with npm's own validator: npm accepts every name it accepts, and refuses every name it says npm refuses", () => {
    const disagreements = PROJECT_NAMES.flatMap((name) => {
      const reason = validateProjectName(name);
      const npmAccepts = validateNpmName(name).validForNewPackages;
      if (reason === null && !npmAccepts) return [`${name}: accepted here, npm refuses it`];
      if (reason?.includes('npm refuses') && npmAccepts) return [`${name}: "${reason}", npm accepts it`];
      return [];
    });
    expect(disagreements).toEqual([]);
  });
});

describe('replacePlaceholders', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTmpDir('forma-lib-');
  });

  afterEach(() => {
    rmrf(dir);
  });

  it('rewrites every occurrence, in nested directories, for known text extensions', () => {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), 'name = "{{PROJECT_NAME}}"');
    fs.writeFileSync(path.join(dir, 'a', 'b', 'x.tsx'), '<h1>{{PROJECT_NAME}}</h1>{{PROJECT_NAME}}');
    replacePlaceholders(dir, { '{{PROJECT_NAME}}': 'my-app' });
    expect(fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8')).toBe('name = "my-app"');
    expect(fs.readFileSync(path.join(dir, 'a', 'b', 'x.tsx'), 'utf8')).toBe('<h1>my-app</h1>my-app');
  });

  it('leaves files with unknown extensions byte-identical', () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    fs.writeFileSync(path.join(dir, 'binary.wasm'), bytes);
    replacePlaceholders(dir, { '{{PROJECT_NAME}}': 'my-app' });
    expect(fs.readFileSync(path.join(dir, 'binary.wasm'))).toEqual(bytes);
  });

  it('does not write through a symlink that points outside the tree', () => {
    if (!canSymlink(dir)) return; // Windows without Developer Mode
    const outsideDir = mkTmpDir('forma-outside-');
    try {
      const outside = path.join(outsideDir, 'victim.toml');
      fs.writeFileSync(outside, 'name = "{{PROJECT_NAME}}"');
      fs.symlinkSync(outside, path.join(dir, 'link.toml'), 'file');

      replacePlaceholders(dir, { '{{PROJECT_NAME}}': 'my-app' });

      expect(fs.readFileSync(outside, 'utf8')).toBe('name = "{{PROJECT_NAME}}"');
    } finally {
      rmrf(outsideDir);
    }
  });

  it('does not descend through a symlinked directory', () => {
    if (!canSymlink(dir)) return;
    const outsideDir = mkTmpDir('forma-outside-');
    try {
      const outside = path.join(outsideDir, 'victim.toml');
      fs.writeFileSync(outside, '{{PROJECT_NAME}}');
      try {
        fs.symlinkSync(outsideDir, path.join(dir, 'linkdir'), 'junction');
      } catch {
        return; // no directory links available here
      }

      replacePlaceholders(dir, { '{{PROJECT_NAME}}': 'my-app' });

      expect(fs.readFileSync(outside, 'utf8')).toBe('{{PROJECT_NAME}}');
    } finally {
      rmrf(outsideDir);
    }
  });
});

describe('restoreGitignores', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTmpDir('forma-lib-');
  });

  afterEach(() => {
    rmrf(dir);
  });

  it('renames _gitignore at every depth', () => {
    fs.mkdirSync(path.join(dir, 'admin', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_gitignore'), 'target/\n');
    fs.writeFileSync(path.join(dir, 'admin', '_gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(dir, 'admin', 'nested', '_gitignore'), 'dist/\n');

    restoreGitignores(dir);

    for (const rel of ['.gitignore', 'admin/.gitignore', 'admin/nested/.gitignore']) {
      expect(fs.existsSync(path.join(dir, ...rel.split('/')))).toBe(true);
    }
    expect(fs.existsSync(path.join(dir, '_gitignore'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'admin', '_gitignore'))).toBe(false);
  });
});

describe('NEVER_COPY', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTmpDir('forma-nevercopy-');
  });

  afterEach(() => {
    rmrf(dir);
  });

  // Drives the real cpSync through the same filter the scaffolder uses, rather
  // than asserting the set's contents, so this fails if either the set or the
  // wiring in src/index.ts regresses.
  it("copies a template's lockfiles, never its installed dependencies or build output", () => {
    const src = path.join(dir, 'template');
    const dest = path.join(dir, 'app');
    fs.mkdirSync(path.join(src, 'admin', 'node_modules', 'left-behind'), { recursive: true });
    fs.mkdirSync(path.join(src, 'admin', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(src, 'target'), { recursive: true });
    fs.writeFileSync(path.join(src, 'admin', 'package.json'), '{}\n');
    fs.writeFileSync(path.join(src, 'admin', 'package-lock.json'), '{"lockfileVersion":3}\n');
    fs.writeFileSync(path.join(src, 'Cargo.lock'), 'version = 4\n');
    fs.writeFileSync(path.join(src, 'admin', 'node_modules', 'left-behind', 'index.js'), '');
    fs.writeFileSync(path.join(src, 'admin', 'dist', 'app.js'), '');

    fs.cpSync(src, dest, {
      recursive: true,
      filter: (s) => !NEVER_COPY.has(path.basename(s)),
    });

    // The lockfiles are the set the scaffold gate tested (DR-32), so a new
    // project installs those versions rather than whatever resolves today.
    expect(fs.existsSync(path.join(dest, 'admin', 'package-lock.json'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'Cargo.lock'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'admin', 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'admin', 'dist'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'target'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'admin', 'package.json'))).toBe(true);
  });
});

describe('placeCargoLockRoot', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTmpDir('forma-cargolock-');
  });

  afterEach(() => {
    rmrf(dir);
  });

  const HEAD = '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n';
  const registry = (name: string, version: string) =>
    `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${'0'.repeat(64)}"\n`;
  const root = (name: string) =>
    `[[package]]\nname = "${name}"\nversion = "0.1.0"\ndependencies = [\n "axum",\n "tokio",\n]\n`;
  const lockfile = (...blocks: string[]) => [HEAD, ...blocks].join('\n');

  it('moves the renamed entry to where cargo sorts it and changes nothing else', () => {
    // As a template ships it, the placeholder sorts last ('{' follows every
    // lower-case letter). Cargo compares names bytewise, so '-' (0x2d) sorts
    // before '_' (0x5f): `my-app` belongs between `my-apa` and `my_apa`,
    // where a locale-aware comparison, which ignores punctuation, would put
    // it after both.
    const lock = path.join(dir, 'Cargo.lock');
    fs.writeFileSync(
      lock,
      lockfile(registry('axum', '0.8.9'), registry('my-apa', '1.0.0'), registry('my_apa', '1.0.0'), registry('tokio', '1.53.3'), root('my-app')),
    );

    placeCargoLockRoot(lock, 'my-app');

    expect(fs.readFileSync(lock, 'utf8')).toBe(
      lockfile(registry('axum', '0.8.9'), registry('my-apa', '1.0.0'), root('my-app'), registry('my_apa', '1.0.0'), registry('tokio', '1.53.3')),
    );
  });

  // The cases below take their expected output from cargo itself, never from
  // hand-written blocks. Each `*-placeholder.lock` is a lockfile cargo wrote
  // for a project with a neutral name, with that name then replaced by the
  // placeholder and its entry moved last, as a template ships it; each
  // `<name>.lock` is what cargo writes for the same graph once the project is
  // named <name>. Regenerate them with `cargo generate-lockfile` on a project
  // depending on `tracing = "0.1"` (or `itoa = "=1.0.18"` at version 1.0.18),
  // then rename the package and let a plain `cargo metadata` rewrite the file.
  const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures', 'cargo-lock');
  const scaffoldLock = (input: string, name: string) => {
    const lock = path.join(dir, 'Cargo.lock');
    const text = fs.readFileSync(path.join(FIXTURES, input), 'utf8');
    fs.writeFileSync(lock, text.replaceAll('{{PROJECT_NAME}}', name));
    placeCargoLockRoot(lock, name);
    return lock;
  };

  // Cargo writes a dependency as a bare "name" only while one package has
  // that name. A project named after a crate in its graph makes two, and
  // every reference to the registry crate then carries its version: the
  // project's own list (`tracing`) or another crate's (`tracing-core`).
  it.each(['tracing', 'tracing-core'])(
    "matches cargo's own lockfile for a project named %s, a crate in its graph, and is then a no-op",
    (name) => {
      const lock = scaffoldLock('placeholder.lock', name);
      const expected = fs.readFileSync(path.join(FIXTURES, `${name}.lock`), 'utf8');
      expect(fs.readFileSync(lock, 'utf8')).toBe(expected);

      const before = fs.statSync(lock).mtimeMs;
      placeCargoLockRoot(lock, name);
      expect(fs.readFileSync(lock, 'utf8')).toBe(expected);
      expect(fs.statSync(lock).mtimeMs).toBe(before);
    },
  );

  it("matches cargo's own lockfile when the project ties a locked crate's name and version", () => {
    // At equal name and version cargo sorts the path package first, and a
    // reference needs the source too: "itoa 1.0.18 (registry+…)".
    const lock = scaffoldLock('tie-placeholder.lock', 'itoa');
    expect(fs.readFileSync(lock, 'utf8')).toBe(fs.readFileSync(path.join(FIXTURES, 'itoa.lock'), 'utf8'));
  });

  it('keeps CRLF line endings, as a Windows checkout of a template has them', () => {
    const lock = path.join(dir, 'Cargo.lock');
    const crlf = (t: string) => t.replace(/\n/g, '\r\n');
    fs.writeFileSync(lock, crlf(lockfile(registry('axum', '0.8.9'), registry('tokio', '1.53.3'), root('app'))));
    placeCargoLockRoot(lock, 'app');
    expect(fs.readFileSync(lock, 'utf8')).toBe(
      crlf(lockfile(root('app'), registry('axum', '0.8.9'), registry('tokio', '1.53.3'))),
    );
  });

  it('does nothing when there is no Cargo.lock', () => {
    expect(() => placeCargoLockRoot(path.join(dir, 'Cargo.lock'), 'app')).not.toThrow();
    expect(fs.existsSync(path.join(dir, 'Cargo.lock'))).toBe(false);
  });
});
