import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, run, save, stageNpmLock, stageCargoLock, packedRuntimeLock } from './release-set.mjs';

function archive(dir, name, manifest, files = {}) {
  const source = join(dir, name);
  mkdirSync(join(source, 'package'), { recursive: true });
  save(join(source, 'package/package.json'), manifest);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(source, 'package', path), content);
  const file = join(dir, `${name}.tgz`);
  run('tar', ['-czf', file, '-C', source, 'package']);
  return { version: manifest.version, resolved: `file:${file}`, integrity: `sha512-${digest(file, 'sha512', 'base64')}`, ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}) };
}

test('local template substitution rejects shipped npm checksum, version, graph and manifest defects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-template-lock-'));
  try {
    archive(dir, 'core', { name: '@getforma/core', version: '3.0.0', dependencies: { external: '1.0.0' } });
    const packages = [{ registry: 'npm', name: '@getforma/core', version: '3.0.0', file: 'core.tgz' }];
    const manifest = { dependencies: { '@getforma/core': '^2.1.0' } };
    const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/@getforma/core': { version: '2.1.0' }, 'node_modules/external': { version: '1.0.0', integrity: 'retained' } } };
    const shipped = stageNpmLock(manifest, lock, packages, dir);
    const entry = 'node_modules/@getforma/core';
    for (const [field, value] of [['integrity', 'sha512-wrong'], ['version', '2.1.0'], ['resolved', 'https://wrong.invalid/core.tgz'], ['dependencies', {}], ['link', true]]) {
      const bad = structuredClone(shipped); bad.lock.packages[entry][field] = value;
      assert.throws(() => stageNpmLock(bad.manifest, bad.lock, packages, dir, true), /shipped template lock/);
    }
    const missing = structuredClone(shipped); delete missing.lock.packages[entry];
    assert.throws(() => stageNpmLock(missing.manifest, missing.lock, packages, dir, true), /missing template lock entry/);
    const wrongRequirement = structuredClone(shipped);
    wrongRequirement.manifest.dependencies['@getforma/core'] = '^2.1.0';
    wrongRequirement.lock.packages[''].dependencies['@getforma/core'] = '^2.1.0';
    assert.throws(() => stageNpmLock(wrongRequirement.manifest, wrongRequirement.lock, packages, dir, true), /requirement disagrees/);
    const staleRoot = structuredClone(shipped); staleRoot.lock.packages[''].dependencies = {};
    assert.throws(() => stageNpmLock(staleRoot.manifest, staleRoot.lock, packages, dir, true), /lock root dependencies/);
    const local = stageNpmLock(shipped.manifest, shipped.lock, packages, dir, true);
    assert.deepEqual(local.lock.packages[entry], { ...shipped.lock.packages[entry], resolved: `file:${join(dir, 'core.tgz')}` });
    assert.deepEqual(local.lock.packages['node_modules/external'], shipped.lock.packages['node_modules/external']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('local Cargo substitution rejects a shipped candidate checksum, source or version defect', () => {
  const checksum = 'c'.repeat(64);
  const packages = [{ registry: 'crates', name: 'forma-ir', version: '3.0.0', sha256: checksum }];
  const shipped = `version = 4\n\n[[package]]\nname = "forma-ir"\nversion = "3.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`;
  for (const bad of [shipped.replace(checksum, 'd'.repeat(64)), shipped.replace('3.0.0', '2.0.0'), shipped.replace('registry+', 'git+'), shipped.replace(/^checksum = .*\n/m, '')]) {
    assert.throws(() => stageCargoLock(bad, packages, true), /shipped Cargo lock/);
  }
  const local = stageCargoLock(shipped, packages, true);
  assert(!local.includes('checksum =')); assert(!local.includes('source ='));
  assert.equal(stageCargoLock(local, packages, true, 'forma-ir'), local, 'only the packed crate root may already be local');
  assert.throws(() => stageCargoLock(local, packages, true), /shipped Cargo lock source/);
});

test('packed CLI executes with only its declared locked runtime closure and refuses an undeclared import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-runtime-lock-'));
  try {
    const leaf = archive(dir, 'leaf', { name: 'forma-test-leaf', version: '1.0.0', type: 'module', main: 'index.js', scripts: { postinstall: 'node -e "process.exit(1)"' } }, { 'index.js': 'export default 42;\n' });
    const runtime = archive(dir, 'runtime', { name: 'forma-test-runtime', version: '1.0.0', type: 'module', main: 'index.js', dependencies: { 'forma-test-leaf': '^1.0.0' } }, { 'index.js': 'export { default } from "forma-test-leaf";\n' });
    const source = { lockfileVersion: 3, packages: {
      'packages/create-app/node_modules/forma-test-runtime': runtime,
      'node_modules/forma-test-leaf': leaf,
      'node_modules/unused': { version: '1.0.0' },
    } };
    const packed = { name: 'forma-test-cli', version: '1.0.0', type: 'module', dependencies: { 'forma-test-runtime': '^1.0.0' }, devDependencies: { unused: '*' } };
    const execute = (name, manifest) => {
      const cli = join(dir, name); mkdirSync(cli);
      const staged = packedRuntimeLock(manifest, source, 'packages/create-app');
      save(join(cli, 'package.json'), staged.manifest); save(join(cli, 'package-lock.json'), staged.lock);
      writeFileSync(join(cli, 'index.js'), 'import value from "forma-test-runtime"; console.log(value);\n');
      const hash = digest(join(cli, 'package-lock.json'));
      run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], cli, { stdio: 'pipe' });
      assert.equal(digest(join(cli, 'package-lock.json')), hash);
      assert(!existsSync(join(cli, 'node_modules/unused')));
      return () => run(process.execPath, [join(cli, 'index.js')], cli, { stdio: 'pipe', env: { ...process.env, NODE_PATH: '' } });
    };
    assert.equal(execute('good', packed)().trim(), '42');
    // Keep identical executable code and source lock; remove only its published declaration.
    const missing = execute('undeclared', { ...packed, dependencies: {} });
    assert.throws(missing, error => /ERR_MODULE_NOT_FOUND/.test(String(error.stderr)));
    assert.throws(() => execute('wrong-range', { ...packed, dependencies: { 'forma-test-runtime': '^2.0.0' } }), /Command failed/);
    assert.throws(() => packedRuntimeLock({ ...packed, dependencies: { missing: '*' } }, source, 'packages/create-app'), /absent from the recorded lock/);
    const unpinned = structuredClone(source); delete unpinned.packages['node_modules/forma-test-leaf'].integrity;
    assert.throws(() => packedRuntimeLock(packed, unpinned, 'packages/create-app'), /integrity-pinned archive/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('candidate runtime additions use a recorded nested closure without changing existing template resolutions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-template-new-deps-'));
  try {
    const previous = archive(dir, 'old-leaf', { name: 'forma-test-leaf', version: '1.0.0', type: 'module', main: 'index.js' }, { 'index.js': 'export default 1;\n' });
    const leaf = archive(dir, 'new-leaf', { name: 'forma-test-leaf', version: '2.0.0', type: 'module', main: 'index.js', scripts: { postinstall: 'node -e "process.exit(1)"' } }, { 'index.js': 'export default 42;\n' });
    const runtime = archive(dir, 'runtime', { name: 'forma-test-runtime', version: '1.0.0', type: 'module', main: 'index.js', dependencies: { 'forma-test-leaf': '^2.0.0' } }, { 'index.js': 'export { default } from "forma-test-leaf";\n' });
    archive(dir, 'build', { name: '@getforma/build', version: '3.0.0', type: 'module', main: 'index.js', dependencies: { 'forma-test-runtime': '^1.0.0' }, peerDependencies: { '@getforma/compiler': '^3.0.0' }, peerDependenciesMeta: { '@getforma/compiler': { optional: true } } }, { 'index.js': 'export { default } from "forma-test-runtime";\n' });
    const packages = [{ registry: 'npm', name: '@getforma/build', version: '3.0.0', file: 'build.tgz' }];
    const manifest = { private: true, type: 'module', dependencies: { '@getforma/build': '^0.3.1', 'forma-test-leaf': '1.0.0' } };
    const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/@getforma/build': { version: '0.3.1' }, 'node_modules/forma-test-leaf': previous } };
    const source = { lockfileVersion: 3, packages: {
      'node_modules/forma-test-runtime': runtime,
      'node_modules/forma-test-leaf': leaf,
      // A workspace peer must be supplied by the release set, never grafted.
      'node_modules/@getforma/compiler': { resolved: 'packages/compiler', link: true },
    } };
    const shipped = stageNpmLock(manifest, lock, packages, dir, false, source);
    assert.deepEqual(shipped.lock.packages['node_modules/forma-test-leaf'], previous);
    const nested = 'node_modules/@getforma/build/node_modules/forma-test-runtime/node_modules/forma-test-leaf';
    assert.equal(shipped.lock.packages[nested].integrity, leaf.integrity);
    assert(!shipped.lock.packages['node_modules/@getforma/build/node_modules/@getforma/compiler']);
    assert.deepEqual(stageNpmLock(manifest, lock, packages, dir, false, source), shipped, 'staging is deterministic');
    const local = stageNpmLock(shipped.manifest, shipped.lock, packages, dir, true);
    const app = join(dir, 'app'); mkdirSync(app);
    save(join(app, 'package.json'), local.manifest); save(join(app, 'package-lock.json'), local.lock);
    const before = digest(join(app, 'package-lock.json'));
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], app, { stdio: 'pipe' });
    assert.equal(digest(join(app, 'package-lock.json')), before);
    const output = run(process.execPath, ['--input-type=module', '-e', 'import value from "@getforma/build"; import old from "forma-test-leaf"; console.log(value, old);'], app, { stdio: 'pipe', env: { ...process.env, NODE_PATH: '' } });
    assert.equal(output.trim(), '42 1');
    const missing = structuredClone(source); delete missing.packages['node_modules/forma-test-leaf'];
    assert.throws(() => stageNpmLock(manifest, lock, packages, dir, false, missing), /absent from the recorded lock/);
    const unpinned = structuredClone(source); delete unpinned.packages['node_modules/forma-test-leaf'].integrity;
    assert.throws(() => stageNpmLock(manifest, lock, packages, dir, false, unpinned), /integrity-pinned archive/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
