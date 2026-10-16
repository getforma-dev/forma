import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertIntendedKill } from './qualify-runtime-migration.mjs';
const control = ['probe', 'test.ts', 'expected control', /expected count 0/];
const proof = (name = 'suite expected control', message = 'AssertionError: expected count 0') => ({ numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ fullName: name, status: 'failed', failureMessages: [message] }] }] });
test('a changed probe needs its named assertion, not an arbitrary red test or exception', () => {
  assert.equal(assertIntendedKill(proof(), control).length, 1);
  assert.throws(() => assertIntendedKill(proof('unrelated control'), control), /unrelated failing test/);
  assert.throws(() => assertIntendedKill(proof(undefined, 'TypeError: expected count 0'), control), /non-assertion/);
  assert.throws(() => assertIntendedKill(proof(undefined, 'AssertionError: some other oracle'), control), /signature absent/);
  const crashed = proof(); crashed.numRuntimeErrorTestSuites = 1;
  assert.throws(() => assertIntendedKill(crashed, control), /runtime suite error/);
  const survived = proof(); survived.testResults[0].assertionResults[0].status = 'passed';
  assert.throws(() => assertIntendedKill(survived, control), /survived/);
});
