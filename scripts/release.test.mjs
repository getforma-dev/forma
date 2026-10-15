import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectRun, checkJobs } from './check-release-ci.mjs';
import { registryStatus, waitForPackage } from './release-publish.mjs';
import { ROOT, SEMVER, assertReleaseSet, stageCargoLock, stageNpmLock, stageTemplates, versionFiles, digest, run, json } from './release-set.mjs';

const sha = 'a'.repeat(40), repo = 'getforma-dev/forma';
const goodRun = { id: 100, head_sha: sha, head_branch: 'main', event: 'push', path: '.github/workflows/ci.yml', repository: { full_name: repo }, status: 'completed', conclusion: 'success', run_number: 7, run_attempt: 1 };
test('SR13 accepts only the latest exact-SHA main CI run', () => {
  assert.equal(selectRun({ workflow_runs: [goodRun] }, sha, repo).id, 100);
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { head_branch: 'other' }, { status: 'in_progress' }, { conclusion: 'failure' }, { repository: { full_name: 'elsewhere/forma' } }, { path: 'other.yml' }]) {
    assert.throws(() => selectRun({ workflow_runs: [{ ...goodRun, ...patch }] }, sha, repo));
  }
  assert.throws(() => selectRun({ workflow_runs: [goodRun, { ...goodRun, run_number: 8, conclusion: 'failure' }] }, sha, repo));
});
test('SR13 missing or unreadable status refuses publication', () => {
  for (const response of [null, {}, { workflow_runs: [] }, { workflow_runs: 'unreadable' }]) assert.throws(() => selectRun(response, sha, repo));
});
test('SR13 a skipped or missing R17/probe job cannot be a successful gate', () => {
  const jobs = [{ name: 'check', status: 'completed', conclusion: 'success', steps: [{ name: "R17's command", conclusion: 'success' }] }, { name: 'release-workflow', status: 'completed', conclusion: 'success' }];
  checkJobs({ jobs });
  for (const bad of [[], [{ ...jobs[0], conclusion: 'skipped' }, jobs[1]], [{ ...jobs[0], steps: [] }, jobs[1]], [jobs[0]]]) assert.throws(() => checkJobs({ jobs: bad }));
});
test('a live tag cannot publish mixed A2 versions, dev versions or a partial set', () => {
  const packages = Array.from({ length: 7 }, (_, i) => ({ name: `package-${i}`, version: '3.0.0-alpha.1' }));
  assert.equal(assertReleaseSet(packages, 'v3.0.0-alpha.1'), '3.0.0-alpha.1');
  assert.throws(() => assertReleaseSet([...packages, {}], 'v3.0.0-alpha.1'));
  assert.throws(() => assertReleaseSet(packages.map((p, i) => i ? p : { ...p, version: '2.1.0' }), 'v3.0.0-alpha.1'));
  for (const tag of ['main', 'v3.0.0-dev', 'v2.0.0', 'v3.0.0;echo pwned', 'v03.0.0']) assert.throws(() => assertReleaseSet(packages, tag));
});
test('version preparation changes seven manifests, exact internal requirements and repositories without publishing', () => {
  const before = json(join(ROOT, 'packages/core/package.json')).version;
  const files = versionFiles(ROOT, '3.0.0-alpha.1');
  for (const name of ['core', 'compiler', 'build', 'create-app']) {
    const p = JSON.parse(files.get(`packages/${name}/package.json`));
    assert.equal(p.version, '3.0.0-alpha.1');
    assert.equal(p.repository.url, 'git+https://github.com/getforma-dev/forma.git');
  }
  assert.match(files.get('Cargo.toml'), /version = "3.0.0-alpha.1"/);
  assert.match(files.get('crates/forma-ir-derive/Cargo.toml'), /version = "3.0.0-alpha.1"/);
  assert.match(files.get('crates/forma-server/Cargo.toml'), /version = "=3.0.0-alpha.1"/);
  assert.match(files.get('packages/create-app/templates/minimal/Cargo.toml'), /forma-ir = "=3.0.0-alpha.1"/);
  assert.equal(json(join(ROOT, 'packages/core/package.json')).version, before, 'pure preparation must not alter source');
  const dev = versionFiles(ROOT, '3.0.1-dev');
  assert(dev.get('Cargo.toml').includes('3.0.1-dev'));
  assert(![...dev.keys()].some(p => p.includes('/templates/')), 'development alignment must preserve A2 template pins');
});
test('version preparation remains valid under the actual internal dependency guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-version-guard-'));
  try {
    for (const version of ['3.0.0-dev', '3.0.0-alpha.1', '3.0.0']) {
      for (const [path, text] of versionFiles(ROOT, version)) {
        const full = join(dir, path);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, text);
      }
      for (const crate of ['forma-ir', 'forma-ir-derive', 'forma-server']) {
        const source = join(dir, 'crates', crate, 'src');
        mkdirSync(source, { recursive: true });
        writeFileSync(join(source, 'lib.rs'), '');
      }
      assert.match(run('bash', [join(ROOT, 'scripts/check-forma-ir-requirement.sh'), join(dir, 'Cargo.toml')]), /ok: forma-server/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Cargo packages unpublished interdependent crates and repacks byte-identically from the same commit and lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-cargo-package-'));
  try {
    writeFileSync(join(dir, '.gitignore'), '/target/\n');
    writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["first", "second"]\nresolver = "2"\n');
    for (const name of ['first', 'second']) {
      mkdirSync(join(dir, name, 'src'), { recursive: true });
      const dependency = name === 'second' ? '\n[dependencies]\nforma-release-test-first = { path = "../first", version = "=3.0.0-alpha.1" }\n' : '';
      writeFileSync(join(dir, name, 'Cargo.toml'), `[package]\nname = "forma-release-test-${name}"\nversion = "3.0.0-alpha.1"\nedition = "2021"\nlicense = "MIT"\ndescription = "Unpublished release packaging test"\n${dependency}`);
      writeFileSync(join(dir, name, 'src/lib.rs'), 'pub fn value() -> u8 { 1 }\n');
    }
    run('cargo', ['generate-lockfile', '--offline'], dir);
    run('git', ['init', '-q'], dir); run('git', ['add', '.'], dir);
    run('git', ['-c', 'user.name=Forma release test', '-c', 'user.email=release-test@example.invalid', 'commit', '-qm', 'fixture'], dir);
    const lock = digest(join(dir, 'Cargo.lock'));
    run('cargo', ['package', '--workspace', '--no-verify', '--locked', '--offline'], dir);
    const first = ['first', 'second'].map(n => digest(join(dir, 'target/package', `forma-release-test-${n}-3.0.0-alpha.1.crate`)));
    run('cargo', ['package', '--workspace', '--no-verify', '--locked', '--offline'], dir);
    assert.deepEqual(['first', 'second'].map(n => digest(join(dir, 'target/package', `forma-release-test-${n}-3.0.0-alpha.1.crate`))), first);
    assert.equal(digest(join(dir, 'Cargo.lock')), lock);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('template Cargo.lock staging preserves third-party resolutions and never invents checksums', () => {
  const source = '[version]\nvalue = 3\n\n[[package]]\nname = "forma-ir"\nversion = "0.2.2"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "old"\n\n[[package]]\nname = "serde"\nversion = "1.2.3"\nchecksum = "untouched"\n';
  const packages = [{ registry: 'crates', name: 'forma-ir', version: '3.0.0', sha256: 'c'.repeat(64) }];
  const shipped = stageCargoLock(source, packages);
  assert(shipped.includes('checksum = "' + 'c'.repeat(64) + '"'));
  assert(shipped.endsWith('name = "serde"\nversion = "1.2.3"\nchecksum = "untouched"\n'));
  const local = stageCargoLock(shipped, packages, true);
  assert(!local.includes('source ='));
  assert(!local.includes('c'.repeat(64)));
  assert.throws(() => stageCargoLock(source.replace('checksum = "old"\n', ''), packages));
});
test('staged npm locks point at the actual packed bytes; local P17 substitutions retain all external locks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-release-test-'));
  try {
    mkdirSync(join(dir, 'package'));
    writeFileSync(join(dir, 'package/package.json'), JSON.stringify({ name: '@getforma/core', version: '3.0.0', dependencies: { 'alien-signals': '3.1.2' } }));
    run('tar', ['-czf', join(dir, 'core.tgz'), '-C', dir, 'package']);
    const manifest = { dependencies: { '@getforma/core': '^2.1.0', external: '1.0.0' } };
    const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/@getforma/core': { version: '2.1.0' }, 'node_modules/external': { version: '1.0.0', integrity: 'exact-lock' } } };
    const packages = [{ registry: 'npm', name: '@getforma/core', version: '3.0.0', file: 'core.tgz' }];
    const shipped = stageNpmLock(manifest, lock, packages, dir);
    assert.equal(shipped.manifest.dependencies['@getforma/core'], '=3.0.0');
    assert.equal(shipped.lock.packages['node_modules/@getforma/core'].integrity, `sha512-${digest(join(dir, 'core.tgz'), 'sha512', 'base64')}`);
    assert.deepEqual(shipped.lock.packages['node_modules/external'], lock.packages['node_modules/external']);
    const local = stageNpmLock(shipped.manifest, shipped.lock, packages, dir, true);
    assert.equal(local.lock.packages['node_modules/@getforma/core'].resolved, `file:${join(dir, 'core.tgz')}`);
    assert.equal(local.manifest.dependencies['@getforma/core'], `file:${join(dir, 'core.tgz')}`);
    assert.equal(lock.packages['node_modules/@getforma/core'].version, '2.1.0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('partial-release rerun accepts only byte-identical existing packages; network failures never mean missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-registry-test-'));
  try {
    writeFileSync(join(dir, 'package.tgz'), 'candidate');
    const p = { registry: 'npm', name: '@getforma/core', version: '3.0.0', file: 'package.tgz' };
    const mock = (status, data) => async () => ({ status, ok: status === 200, json: async () => data });
    assert.equal(await registryStatus(p, dir, mock(404)), 'missing');
    assert.equal(await registryStatus(p, dir, mock(200, { dist: { integrity: `sha512-${digest(join(dir, 'package.tgz'), 'sha512', 'base64')}` } })), 'present');
    await assert.rejects(registryStatus(p, dir, mock(503)));
    await assert.rejects(registryStatus(p, dir, mock(200, { dist: { integrity: 'different' } })));
    const crate = { registry: 'crates', name: 'forma-ir', version: '3.0.0', sha256: 'd'.repeat(64) };
    assert.equal(await registryStatus(crate, dir, mock(200, { version: { checksum: crate.sha256, yanked: false } })), 'present');
    await assert.rejects(registryStatus(crate, dir, mock(200, { version: { checksum: crate.sha256, yanked: true } })));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('registry polling never starts a request after its fixed deadline', async () => {
  let clock = 0, calls = 0;
  const options = { now: () => clock, sleep: async ms => { clock += ms; }, request: async () => { calls++; clock += 400; return { status: 404 }; } };
  await assert.rejects(waitForPackage({ name: 'test', registry: 'crates', version: '1.0.0' }, '/', 1000, options), /deadline/);
  assert.equal(calls, 1);
  assert.equal(clock, 1000);
  calls = 0;
  await assert.rejects(waitForPackage({ name: 'test' }, '/', 0, options), /deadline/);
  assert.equal(calls, 0);
});

test('malformed second template leaves every source file unchanged during staging', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-stage-test-'));
  const before = new Map();
  try {
    for (const name of ['minimal', 'dashboard']) {
      const base = join(dir, 'packages/create-app/templates', name);
      mkdirSync(join(base, 'admin'), { recursive: true });
      for (const [file, content] of [
        ['admin/package.json', '{}\n'], ['admin/package-lock.json', '{"packages":{"":{}}}\n'],
        ['Cargo.lock', '[[package]]\nname = "forma-ir"\nversion = "0.2.2"\n' + (name === 'minimal' ? 'checksum = "original"\n' : '')],
      ]) { const path = join(base, file); writeFileSync(path, content); before.set(path, content); }
    }
    assert.throws(() => stageTemplates(dir, [{ registry: 'crates', name: 'forma-ir', version: '3.0.0', sha256: 'a'.repeat(64) }], dir), /missing checksum/);
    for (const [path, content] of before) assert.equal(readFileSync(path, 'utf8'), content);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
