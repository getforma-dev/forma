import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleTrustPolicy, ROOT } from './release-set.mjs';
const policy = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
test('release packing accepts current SECURITY.md with implemented M10 and deferred admission', () => {
  assert.doesNotThrow(() => assertModuleTrustPolicy(policy));
});
test('release packing requires every trusted-producer and deferred-admission boundary', () => {
  for (const clause of ['FMIR is a **trusted input**', 'Only run IR produced by a compiler you trust', "every FMIR module must come from the application's own build", 'any other source requires M9 before admission', 'M9 and design5 remain deferred', '3.0 does not provide an untrusted-module admission mechanism', 'Fuzzing does not authenticate module producers.', 'Structural validation does not establish who produced a module (SA4).']) {
    assert(policy.includes(clause), `control clause exists: ${clause}`);
    assert.throws(() => assertModuleTrustPolicy(policy.replace(clause, 'removed')), /SA4/, clause);
  }
});
test('fuzzing status and admission cannot be inverted or conflated', () => {
  for (const [current, changed] of [
    ['M9 and design5 remain deferred', 'M9 and design5 are implemented'],
    ['3.0 does not provide an untrusted-module admission mechanism', '3.0 provides an untrusted-module admission mechanism'],
    ['Decoder/walker fuzzing (M10) is implemented:', 'Decoder/walker fuzzing (M10) is deferred:'],
    ['runs `parse_raw`, `parse_body`, `parse_mutated` and `walk` under AddressSanitizer', 'runs decoder tests without AddressSanitizer'],
    ['Fuzzing does not authenticate module producers.', 'Fuzzing authenticates module producers.'],
    ['Structural validation does not establish who produced a module (SA4).', 'Structural validation establishes who produced a module (SA4).'],
  ]) {
    assert(policy.includes(current), `control clause exists: ${current}`);
    assert.throws(() => assertModuleTrustPolicy(policy.replace(current, changed)), /SA4/, changed);
  }
  assert.throws(() => assertModuleTrustPolicy(`${policy}\nM9, M10 and design5 are deferred.\n`), /SA4/, 'contradictory historical M10 status');
});
