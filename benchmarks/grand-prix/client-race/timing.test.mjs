import assert from 'node:assert/strict';
import test from 'node:test';
import { measuredDuration, operationGeomean } from './timing.mjs';

test('completed zero and sub-resolution measurements remain unchanged in raw samples', () => {
  for (const ms of [0, 0.05, 0.1, 20]) assert.equal(measuredDuration(ms, 'vanilla select'), ms);
});

test('negative, non-finite and non-numeric timings still invalidate a run', () => {
  for (const ms of [-0.1, NaN, Infinity, -Infinity, null, '0', undefined]) {
    assert.throws(() => measuredDuration(ms, 'vanilla select'), /vanilla select: invalid timing/);
  }
});

test('only the geometric summary floors valid zero readings to the established clock step', () => {
  const means = [0, 0.05, 10];
  assert(Math.abs(operationGeomean(means) - Math.cbrt(0.1 * 0.1 * 10)) < 1e-12);
  assert.deepEqual(means, [0, 0.05, 10]);
  assert(Math.abs(operationGeomean([0, 0]) - 0.1) < 1e-12);
  assert.throws(() => operationGeomean([1, -1]), /invalid timing/);
});
