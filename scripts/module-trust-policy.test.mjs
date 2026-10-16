import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleTrustPolicy, ROOT } from './release-set.mjs';
const policy = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
test('release packing requires own-build provenance and explicit deferred admission', () => {
  assert.doesNotThrow(() => assertModuleTrustPolicy(policy));
  for (const clause of ['FMIR is a **trusted input**', 'Only run IR produced by a compiler you trust', "every FMIR module must come from the application's own build", 'any other source requires M9 before admission', 'M9, M10 and design5 are deferred']) {
    assert.throws(() => assertModuleTrustPolicy(policy.replace(clause, 'removed')), /SA4/, clause);
  }
});
