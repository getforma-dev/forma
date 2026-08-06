import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  NEVER_COPY,
  replacePlaceholders,
  restoreGitignores,
  validateProjectName,
} from '../src/scaffold';
import { mkTmpDir, rmrf } from './helpers';

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

describe('validateProjectName', () => {
  it.each(['app', 'my-app', 'my_app', 'a', 'x9', 'x'.repeat(64)])('accepts %s', (name) => {
    expect(validateProjectName(name)).toBeNull();
  });

  it.each([
    '',
    '..',
    '../escape',
    'a/b',
    'a\\b',
    '/abs',
    'C:tricky',
    'My-App',
    '-leading',
    '_leading',
    '.hidden',
    'has space',
    'con',
    'LPT1'.toLowerCase(),
    'x'.repeat(65),
  ])('rejects %j', (name) => {
    expect(validateProjectName(name)).toBeTypeOf('string');
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
  it('never copies a lockfile or a build directory out of a template', () => {
    const src = path.join(dir, 'template');
    const dest = path.join(dir, 'app');
    fs.mkdirSync(path.join(src, 'admin', 'node_modules', 'left-behind'), { recursive: true });
    fs.mkdirSync(path.join(src, 'admin', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(src, 'target'), { recursive: true });
    fs.writeFileSync(path.join(src, 'admin', 'package.json'), '{}\n');
    fs.writeFileSync(path.join(src, 'admin', 'package-lock.json'), '{"lockfileVersion":3}\n');
    fs.writeFileSync(path.join(src, 'admin', 'node_modules', 'left-behind', 'index.js'), '');
    fs.writeFileSync(path.join(src, 'admin', 'dist', 'app.js'), '');

    fs.cpSync(src, dest, {
      recursive: true,
      filter: (s) => !NEVER_COPY.has(path.basename(s)),
    });

    // The lockfile is the quiet one: npm honours it over the ranges in
    // package.json, so one committed template lockfile pins every app
    // scaffolded after it to the versions that resolved that day.
    expect(fs.existsSync(path.join(dest, 'admin', 'package-lock.json'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'admin', 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'admin', 'dist'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'target'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'admin', 'package.json'))).toBe(true);
  });
});
