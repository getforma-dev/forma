/** Fail closed on runner/collection failures; only observed assertions kill. */
import assert from 'node:assert/strict';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const key = test => `${test.file}\0${test.id}\0${test.name}`;

export function readProbeReport(text, processResult) {
  assert(!processResult.error && !processResult.signal, 'mutation process error, timeout or signal');
  assert(processResult.status === 0 || processResult.status === 1, 'unexpected mutation process exit');
  const report = JSON.parse(text);
  assert(report?.schema === 1 && ['passed', 'failed', 'interrupted'].includes(report.reason), 'missing or interrupted Vitest report');
  assert.equal(report.processTimeout, false, 'Vitest process timeout');
  assert(Array.isArray(report.cancellations), 'missing cancellation evidence');
  assert(report.cancellations.every(reason => reason === 'test-failure'), 'external/unknown run cancellation');
  if (report.reason === 'interrupted') assert(report.cancellations.length > 0, 'interrupted without test-failure bail');
  else assert.equal(report.cancellations.length, 0, 'inconsistent cancellation state');
  for (const field of ['incompleteHooks', 'unhandledErrors']) {
    assert(Array.isArray(report[field]) && report[field].length === 0, `${field} invalidate mutation result`);
  }
  assert(Array.isArray(report.modules) && report.modules.length > 0, 'missing test modules');
  const tests = [], files = new Set(), identities = new Set();
  for (const module of report.modules) {
    assert(nonempty(module.file) && !files.has(module.file), 'invalid/duplicate test module'); files.add(module.file);
    assert(['passed', 'failed', 'skipped', 'pending', 'queued'].includes(module.state), 'invalid module state');
    assert(Array.isArray(module.errors) && module.errors.length === 0, 'module/collection errors invalidate mutation result');
    assert(Array.isArray(module.tests), 'missing module tests');
    for (const test of module.tests) {
      assert(nonempty(test.id) && nonempty(test.name), 'missing test identity');
      const row = { ...test, file: module.file }, identity = key(row);
      assert(!identities.has(identity), 'duplicate test identity'); identities.add(identity);
      assert(['passed', 'failed', 'skipped', 'pending'].includes(test.state), 'invalid test state');
      assert(typeof test.started === 'boolean' && typeof test.finished === 'boolean', 'missing execution evidence');
      assert(Array.isArray(test.errors), 'missing test errors');
      assert.equal(test.retryCount, 0, 'retries cannot qualify mutation evidence');
      if (test.state === 'passed' || test.state === 'failed') {
        assert(test.started && test.finished && finite(test.startTime) && test.startTime > 0
          && finite(test.duration) && test.duration >= 0, 'test was not executed to completion');
      }
      for (const error of test.errors) {
        assert(error && typeof error.name === 'string' && typeof error.code === 'string'
          && nonempty(error.message) && typeof error.stack === 'string' && typeof error.assertion === 'boolean', 'invalid structured test error');
      }
      if (test.state === 'failed') {
        assert(test.errors.length > 0 && test.errors.every(error => error.assertion), 'test failed without an assertion');
      } else assert.equal(test.errors.length, 0, 'errors outside a failed assertion');
      tests.push(row);
    }
  }
  assert(tests.length > 0, 'no tests collected');
  const failed = tests.filter(test => test.state === 'failed');
  if (failed.length) {
    assert.equal(processResult.status, 1, 'failed assertion requires failed process');
    assert(report.reason === 'failed' || report.reason === 'interrupted', 'failed assertion requires failed run');
  } else {
    assert.equal(processResult.status, 0, 'process failed without an assertion');
    assert.equal(report.reason, 'passed', 'run failed without an assertion');
    assert(report.modules.every(module => module.state === 'passed'), 'incomplete test module');
    assert(tests.every(test => test.state === 'passed' || test.state === 'skipped'), 'incomplete test run');
  }
  return { tests, failed };
}

export function cleanProbeBaseline(text, processResult) {
  const report = readProbeReport(text, processResult);
  assert.equal(report.failed.length, 0, 'clean baseline has failed assertions');
  assert(report.tests.some(test => test.state === 'passed'), 'baseline has no executed tests');
  return report.tests;
}

export function classifyProbe(text, processResult, baseline) {
  assert(Array.isArray(baseline) && baseline.some(test => test.state === 'passed'), 'missing clean baseline');
  const report = readProbeReport(text, processResult);
  const original = new Map(baseline.map(test => [key(test), test.state]));
  for (const test of report.tests) assert(original.has(key(test)), 'test missing from clean baseline');
  if (report.failed.length) {
    for (const test of report.failed) assert.equal(original.get(key(test)), 'passed', 'failed test was not passing in clean baseline');
    const assertion = report.failed[0];
    return { caught: true, killedBy: `${assertion.file} > ${assertion.name}`, failedAssertions: report.failed.length };
  }
  assert.equal(report.tests.length, baseline.length, 'passing run has missing tests');
  for (const test of report.tests) assert.equal(test.state, original.get(key(test)), 'passing run changed baseline test execution');
  return { caught: false, killedBy: null, failedAssertions: 0 };
}
