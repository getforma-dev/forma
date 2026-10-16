import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from './verify-release-set.mjs';
import { ROOT } from './release-set.mjs';
import { pruneCargoLock } from './release-fixture-apps.mjs';

test('the standalone deployment lock preserves pinned dependencies without unrelated workspace features', () => {
  const version = '9.9.9';
  const workspace = pruneCargoLock(readFileSync(join(ROOT, 'e2e/Cargo.lock'), 'utf8'), 'forma-e2e-skew', version);
  const standalone = pruneCargoLock(readFileSync(join(ROOT, 'e2e/skew/Cargo.release.lock'), 'utf8'), 'forma-e2e-skew', version);
  // The e2e workspace enables this optional edge elsewhere. Carrying it into
  // this standalone crate makes cargo --locked refuse before the drill runs.
  const expected = workspace.split(/(?=^\[\[package\]\]\n)/m)
    .filter(block => !/^name = "valuable"$/m.test(block))
    .map(block => /^name = "tracing-core"$/m.test(block) ? block.replace(' "valuable",\n', '') : block)
    .join('').trimEnd() + '\n';
  assert.notEqual(workspace, standalone, 'the standalone seed must not inherit workspace-only feature edges');
  assert.equal(standalone, expected, 'no third-party version, checksum or other dependency may drift');
  for (const name of ['forma-ir', 'forma-ir-derive', 'forma-server']) {
    assert(standalone.includes(`name = "${name}"\nversion = "${version}"`));
  }
});

test('P17 refuses unknown deployment contracts before inspecting packages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-skew-contract-'));
  try {
    const candidate = deploymentSkew => writeFileSync(join(dir, 'release-set.json'), JSON.stringify({
      contracts: { props: null, deploymentSkew },
      packages: [{ file: 'unpacked-sentinel.tgz', sha256: '0'.repeat(64) }],
    }));
    for (const contract of ['native-v2', '', false, 0, {}]) {
      candidate(contract);
      await assert.rejects(verify(dir, join(dir, 'report.json')), /P17 has no verifier for the recorded deployment skew contract/);
    }
    // The supported and historical contracts reach package verification. This
    // sentinel prevents any unpack/build/browser work while proving admission.
    for (const contract of [undefined, null, 'native-v1']) {
      candidate(contract);
      await assert.rejects(verify(dir, join(dir, 'report.json')), error =>
        error.code === 'ENOENT' && error.path === join(dir, 'unpacked-sentinel.tgz'));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
