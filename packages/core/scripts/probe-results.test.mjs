import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProbeBaseline, classifyProbe } from './probe-results.mjs';

const processResult = { status: 0, signal: null, error: null };
const assertion = { name: 'AssertionError', code: '', message: 'expected false to be true', stack: 'AssertionError: expected false to be true\n at spec.test.ts:4', assertion: true };
function report() {
  return { schema: 1, reason: 'passed', cancellations: [], processTimeout: false, incompleteHooks: [], unhandledErrors: [], modules: [{
    file: '/spec.test.ts', state: 'passed', errors: [], tests: [{ id: 'one', name: 'denies unsafe input', state: 'passed', started: true, finished: true, startTime: 1, duration: 1, retryCount: 0, errors: [] }],
  }] };
}
const encode = value => JSON.stringify(value);
const clean = () => cleanProbeBaseline(encode(report()), processResult);
function failed() {
  const data = report(); data.reason = 'failed'; data.modules[0].state = 'failed';
  Object.assign(data.modules[0].tests[0], { state: 'failed', errors: [assertion] }); return data;
}
const classify = data => classifyProbe(encode(data), { ...processResult, status: 1 }, clean());

test('only an executed assertion in a previously passing test qualifies as a kill', () => {
  assert.deepEqual(classify(failed()), { caught: true, killedBy: '/spec.test.ts > denies unsafe input', failedAssertions: 1 });
  assert.equal(classifyProbe(encode(report()), processResult, clean()).caught, false);
});
test('a dirty or all-skipped baseline cannot qualify any mutant', () => {
  assert.throws(() => cleanProbeBaseline(encode(failed()), { ...processResult, status: 1 }), /clean baseline/);
  const data = report(); data.modules[0].tests[0].state = 'skipped';
  assert.throws(() => cleanProbeBaseline(encode(data), processResult), /no executed tests/);
});
test('compiler, collection and unhandled errors cannot masquerade as an assertion kill', () => {
  for (const mutate of [
    data => data.modules[0].errors.push({ message: 'transform syntax error' }),
    data => data.unhandledErrors.push({ message: 'unhandled rejection' }),
    data => data.incompleteHooks.push('one:beforeEach'),
  ]) { const data = failed(); mutate(data); assert.throws(() => classify(data), /invalidate/); }
});
test('plain runtime errors and test timeout errors never count', () => {
  for (const message of ['missing variable', 'Test timed out in 20ms', 'expected to be denied']) {
    const data = failed(); data.modules[0].tests[0].errors = [{ ...assertion, name: 'Error', message, assertion: false }];
    assert.throws(() => classify(data), /without an assertion/);
  }
});
test('timeouts, signals, unexpected exits and missing/invalid reports cannot count', () => {
  for (const change of [{ signal: 'SIGTERM' }, { error: 'spawn ETIMEDOUT' }, { status: null }, { status: 2 }]) {
    assert.throws(() => classifyProbe(encode(failed()), { ...processResult, ...change }, clean()), /process/);
  }
  for (const text of ['', '{', 'null', '{}']) assert.throws(() => classifyProbe(text, { ...processResult, status: 1 }, clean()));
});
test('reported failure needs actual execution, completion, timing and no retry', () => {
  for (const change of [{ started: false }, { finished: false }, { startTime: null }, { duration: null }, { retryCount: 1 }]) {
    const data = failed(); Object.assign(data.modules[0].tests[0], change); assert.throws(() => classify(data));
  }
});
test('a completed assertion does not excuse a second interrupted assertion', () => {
  const baseline = clean(); baseline.push({ ...baseline[0], id: 'two', name: 'second assertion' });
  const data = failed(); data.reason = 'interrupted'; data.cancellations = ['test-failure', 'test-failure'];
  data.modules[0].tests.push({ ...data.modules[0].tests[0], id: 'two', name: 'second assertion', finished: false, duration: 0 });
  assert.throws(() => classifyProbe(encode(data), { ...processResult, status: 1 }, baseline), /not executed to completion/);
});
test('missing tests, unknown identities and a previously skipped test cannot kill', () => {
  let data = failed(); data.modules[0].tests = []; assert.throws(() => classify(data), /no tests/);
  data = failed(); data.modules[0].tests[0].id = 'other'; assert.throws(() => classify(data), /missing from clean baseline/);
  const baseline = clean(); baseline.push({ ...baseline[0], id: 'skipped', state: 'skipped' });
  data = failed(); data.modules[0].tests[0].id = 'skipped';
  assert.throws(() => classifyProbe(encode(data), { ...processResult, status: 1 }, baseline), /not passing/);
  assert.throws(() => classifyProbe(encode(report()), processResult, baseline), /missing tests/);
});
test('inconsistent exit/report states and duplicate tests are rejected', () => {
  assert.throws(() => classifyProbe(encode(failed()), processResult, clean()), /failed process/);
  assert.throws(() => classifyProbe(encode(report()), { ...processResult, status: 1 }, clean()), /without an assertion/);
  const data = failed(); data.modules[0].tests.push({ ...data.modules[0].tests[0] }); assert.throws(() => classify(data), /duplicate/);
});

test('only observed test-failure bail can interrupt a qualifying assertion run', () => {
  const data = failed(); data.reason = 'interrupted'; data.cancellations = ['test-failure'];
  assert.equal(classify(data).caught, true);
  for (const reasons of [[], ['keyboard-input'], ['unknown'], ['test-failure', 'keyboard-input']]) {
    data.cancellations = reasons; assert.throws(() => classify(data), /cancellation|without test-failure/);
  }
  const passed = report(); passed.reason = 'interrupted'; passed.cancellations = ['test-failure'];
  assert.throws(() => classifyProbe(encode(passed), { ...processResult, status: 1 }, clean()), /without an assertion/);
});
