import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { nodeLines } from './toolchain-matrix.mjs';
const root = resolve(import.meta.dirname, '..');
test('N8 adds Node 26 at its exact UTC boundary, with no unsupported older line', () => {
  assert.deepEqual(nodeLines(new Date('2026-10-27T23:59:59.999Z')), [22, 24]);
  assert.deepEqual(nodeLines(new Date('2026-10-28T00:00:00.000Z')), [22, 24, 26]);
  assert.throws(() => nodeLines(new Date('invalid')));
});
test('actual workflow and manifests agree; seeded claim, matrix and execution drift fail', () => {
  execFileSync('ruby', [join(root, 'scripts/check-toolchain-policy.rb')], { cwd: root, timeout: 10_000 });
  const scratch = mkdtempSync(join(tmpdir(), 'forma-toolchain-policy-'));
  try {
    const files = ['.github/workflows/ci.yml', 'scripts/toolchain-matrix.mjs',
      ...['core','compiler','build','create-app'].map(n => `packages/${n}/package.json`),
      ...['forma-ir','forma-ir-derive','forma-server'].map(n => `crates/${n}/Cargo.toml`)];
    for (const file of files) { mkdirSync(resolve(scratch, file, '..'), { recursive: true }); copyFileSync(join(root, file), join(scratch, file)); }
    const workflow = readFileSync(join(scratch, files[0]), 'utf8');
    const cases = [
      ['packages/compiler/package.json', s => s.replace('"node": ">=22"', '"node": ">=18"')],
      ['crates/forma-ir/Cargo.toml', s => s.replace('rust-version = "1.71"', 'rust-version = "1.70"')],
      [files[0], s => s.replace('node-version: ${{ fromJSON(needs.toolchains.outputs.node-versions) }}', 'node-version: [22]')],
      [files[0], s => s.replace('  node:\n', '  node:\n    continue-on-error: true\n')],
      [files[0], s => s.replace('      - run: npm test --workspaces', '      - run: echo skipped')],
      [files[0], s => s.replace('      - run: bash scripts/check-msrv-fresh.sh', '      - if: false\n        run: bash scripts/check-msrv-fresh.sh')],
    ];
    for (const [file, mutate] of cases) {
      const path = join(scratch, file), before = readFileSync(path, 'utf8'), after = mutate(before);
      assert.notEqual(after, before, `seed ${file} must change actual input`);
      writeFileSync(path, after);
      const result = spawnSync('ruby', [join(root, 'scripts/check-toolchain-policy.rb'), scratch], { encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 1, `${file}: drift was not rejected: ${result.stderr}`);
      writeFileSync(path, before);
    }
    assert.equal(readFileSync(join(scratch, files[0]), 'utf8'), workflow);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
