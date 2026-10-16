import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from './verify-release-set.mjs';

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
