import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { nodeLines } from './toolchain-matrix.mjs';
const root = resolve(import.meta.dirname, '..');
const policyFiles = ['.github/workflows/ci.yml', '.github/workflows/e2e-engines.yml',
  '.github/workflows/nightly-probes.yml', '.github/workflows/value-rules.yml', '.github/workflows/advisories.yml',
  '.github/workflows/release-plane-observe.yml', '.github/workflows/rc-burn-in.yml',
  '.node-version', 'package.json', 'scripts/toolchain-matrix.mjs',
  ...['core','compiler','build','router','create-app'].map(n => `packages/${n}/package.json`),
  ...['forma-ir','forma-ir-derive','forma-server'].map(n => `crates/${n}/Cargo.toml`)];
function copyPolicy(scratch) {
  for (const file of policyFiles) {
    mkdirSync(resolve(scratch, file, '..'), { recursive: true });
    copyFileSync(join(root, file), join(scratch, file));
  }
}
function editJob(source, name, edit) {
  const marker = `  ${name}:\n`, start = source.indexOf(marker);
  assert(start >= 0, `missing actual job ${name}`);
  const next = source.slice(start + marker.length).search(/^  [a-z][a-z0-9-]*:/m);
  const end = next < 0 ? source.length : start + marker.length + next;
  const before = source.slice(start, end), after = edit(before);
  assert.notEqual(after, before, `seed ${name} must change actual input`);
  return source.slice(0, start) + after + source.slice(end);
}
test('N8 adds Node 26 at its exact UTC boundary, with no unsupported older line', () => {
  assert.deepEqual(nodeLines(new Date('2026-10-27T23:59:59.999Z')), [22, 24]);
  assert.deepEqual(nodeLines(new Date('2026-10-28T00:00:00.000Z')), [22, 24, 26]);
  assert.throws(() => nodeLines(new Date('invalid')));
});
test('actual workflow and manifests agree; seeded claim, matrix and execution drift fail', () => {
  execFileSync('ruby', [join(root, 'scripts/check-toolchain-policy.rb')], { cwd: root, timeout: 10_000 });
  // Canonicalize macOS /var -> /private/var so the copied module's CLI guard
  // receives the same path Node uses for import.meta.url.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'forma-toolchain-policy-')));
  try {
    const files = policyFiles;
    copyPolicy(scratch);
    execFileSync('ruby', [join(root, 'scripts/check-toolchain-policy.rb'), scratch], { cwd:root, timeout:10_000 });
    const workflow = readFileSync(join(scratch, files[0]), 'utf8');
    const cases = [
      ['packages/compiler/package.json', s => s.replace('"node": ">=22"', '"node": ">=18"'), /tested floor/],
      ['crates/forma-ir/Cargo.toml', s => s.replace('rust-version = "1.71"', 'rust-version = "1.70"'), /MSRV matrix differs/],
      [files[0], s => s.replace('node-version: ${{ fromJSON(needs.toolchains.outputs.node-versions) }}', 'node-version: [22]'), /Node job must consume/],
      [files[0], s => s.replace('  node:\n', '  node:\n    continue-on-error: true\n'), /Node job must consume/],
      [files[0], s => s.replace('      - run: npm test --workspaces', '      - run: echo skipped'), /Node job does not execute test/],
      [files[0], s => s.replace('      - run: bash scripts/check-msrv-fresh.sh', '      - if: false\n        run: bash scripts/check-msrv-fresh.sh'), /missing mandatory MSRV check/],
    ];
    for (const [file, mutate, message] of cases) {
      const path = join(scratch, file), before = readFileSync(path, 'utf8'), after = mutate(before);
      assert.notEqual(after, before, `seed ${file} must change actual input`);
      writeFileSync(path, after);
      const result = spawnSync('ruby', [join(root, 'scripts/check-toolchain-policy.rb'), scratch], { encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 1, `${file}: drift was not rejected: ${result.stderr}`);
      assert.match(result.stderr,message,`${file}: must reject the intended drift`);
      writeFileSync(path, before);
    }
    assert.equal(readFileSync(join(scratch, files[0]), 'utf8'), workflow);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
test('maintenance pin drift refuses without replacing published compatibility lines', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'forma-maintenance-policy-')));
  try {
    copyPolicy(scratch);
    const run = () => spawnSync('ruby', [join(root, 'scripts/check-toolchain-policy.rb'), scratch], { encoding:'utf8', timeout:10_000 });
    const baseline=run();
    assert.equal(baseline.status, 0, `unchanged maintenance and compatibility policies must agree: ${baseline.stderr}`);
    const cases = [
      ...[['ci.yml','check'],['ci.yml','toolchains'],['e2e-engines.yml','e2e'],
        ['nightly-probes.yml','expressions'],['nightly-probes.yml','probes'],['value-rules.yml','qualify'],
        ['release-plane-observe.yml','observe'],['rc-burn-in.yml','burn-in']].map(([file,job]) =>
        [`.github/workflows/${file}`, s => editJob(s,job,j => j.replace('node-version-file: .node-version','node-version: 24')), /maintenance must/]),
      ['.github/workflows/ci.yml', s => editJob(s,'check',j => j.replace('node-version-file: .node-version','node-version-file: .node-version\n          node-version: 24.21.0')), /maintenance must/],
      ['.github/workflows/ci.yml', s => editJob(s,'check',j => j.replace('      - uses: actions/setup-node@','      - if: false\n        uses: actions/setup-node@')), /maintenance must/],
      ['.github/workflows/ci.yml', s => editJob(s,'check',j => j.replace('          cache: npm','          cache: npm\n      - uses: actions/setup-node@unreviewed\n        with:\n          node-version: 24.21.0')), /maintenance must/],
      ['.github/workflows/advisories.yml', s => s.replace('node-version: 24.22.0','node-version: 24.21.0'), /literal maintenance Node/],
      ['.node-version', () => '24.21.0\n', /private workspace Node range/],
      ['.node-version', () => '24\n', /complete release version/],
      ['package.json', s => s.replace('>=24.22.0 <25','>=24.21.0 <25'), /private workspace Node range/],
      ['packages/compiler/package.json', s => s.replace('"node": ">=22"','"node": ">=24"'), /tested floor/],
    ];
    for (const [file,mutate,message] of cases) {
      const path=join(scratch,file), before=readFileSync(path,'utf8'), after=mutate(before);
      assert.notEqual(after,before,`seed ${file} must change actual input`);
      writeFileSync(path,after);
      const result=run();
      assert.equal(result.status,1,`${file}: drift not rejected: ${result.stderr}`);
      assert.match(result.stderr,message,`${file}: must fail for the intended policy`);
      writeFileSync(path,before);
    }
    rmSync(join(scratch,'.node-version'));
    const missing=run();
    assert.equal(missing.status,1); assert.match(missing.stderr,/missing maintenance Node pin/);
    copyFileSync(join(root,'.node-version'),join(scratch,'.node-version'));
    assert.equal(run().status,0,'restored policy must still accept the existing compatibility matrix');
  } finally { rmSync(scratch,{recursive:true,force:true}); }
});
