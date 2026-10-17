import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualifyRuntimeMigration, assertIntendedKill } from './qualify-runtime-migration.mjs';
const control = ['probe', 'test.ts', 'expected control', /expected count 0/];
const proof = (name = 'suite expected control', message = 'AssertionError: expected count 0') => ({ unhandledErrors: [], testResults: [{ assertionResults: [{ fullName: name, status: 'failed', failureMessages: [message] }] }] });
test('a changed probe needs its named assertion, not an arbitrary red test or exception', () => {
  assert.equal(assertIntendedKill(proof(), control).length, 1);
  assert.throws(() => assertIntendedKill(proof('unrelated control'), control), /unrelated failing test/);
  assert.throws(() => assertIntendedKill(proof(undefined, 'TypeError: expected count 0'), control), /non-assertion/);
  assert.throws(() => assertIntendedKill(proof(undefined, 'AssertionError: some other oracle'), control), /signature absent/);
  const crashed = proof(); crashed.unhandledErrors = [{ message: 'unrelated rejected promise' }];
  assert.throws(() => assertIntendedKill(crashed, control), /unhandled runtime errors/);
  const missing = proof(); delete missing.unhandledErrors;
  assert.throws(() => assertIntendedKill(missing, control), /unhandled runtime errors/);
  const survived = proof(); survived.testResults[0].assertionResults[0].status = 'passed';
  assert.throws(() => assertIntendedKill(survived, control), /survived/);
});

test('prior output is refused before any stale successful JSON can be read', () => {
  const output = mkdtempSync(join(tmpdir(), 'forma-108-stale-proof-'));
  try {
    writeFileSync(join(output, 'before.json'), JSON.stringify({ success: true }));
    assert.throws(() => qualifyRuntimeMigration(output), { code: 'EEXIST' });
  } finally { rmSync(output, { recursive: true, force: true }); }
});
