import test from 'node:test';
import assert from 'node:assert/strict';
import { recordVerificationCheck } from './verify-release-set.mjs';

test('P17 keeps the failed check identity, rethrows the same error and does not copy payloads', async () => {
  const report = { passed: false, tests: [] };
  await recordVerificationCheck(report, 'prior check', async () => {});
  const failure = new Error('declared props differ\nlarge binary diff must not enter the verdict');
  failure.stdout = 'unnecessary child payload';
  await assert.rejects(recordVerificationCheck(report, 'declared props', async () => { throw failure; }), error => error === failure);
  assert.equal(report.passed, false);
  assert.deepEqual(report.tests.map(({ seconds, ...row }) => row), [
    { name: 'prior check', passed: true },
    { name: 'declared props', passed: false, error: { name: 'Error', message: 'declared props differ' } },
  ]);
  assert(report.tests.every(row => Number.isFinite(row.seconds) && row.seconds >= 0));
  assert(!JSON.stringify(report).includes('payload'));
});
test('P17 bounds failure messages without losing rejection', async () => {
  const report = { tests: [] };
  await assert.rejects(recordVerificationCheck(report, 'bounded', () => { throw Error('x'.repeat(1000)); }));
  assert.equal(report.tests[0].error.message.length, 512);
  assert.equal(report.tests[0].passed, false);
});
