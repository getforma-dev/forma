import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { measureIndexedPublicSet } from './indexed-timing.ts';

// Run the exact serialized browser collector. The synthetic public operation
// advances a quantized clock by a known cost, retaining identity no-ops; no
// real browser time or product performance is inferred from these controls.
function collect({ largeFactor = 1, singleCost = .02, underresolved = false, tooFast = false } = {}) {
  let elapsed = 0, clockCalls = 0;
  const counts = { small: 0, large: 0 }, current = {}, intervals = [];
  let pending = [];
  const handles = Object.fromEntries(['small', 'large'].map(name => [name, { set(key, value) {
    assert.equal(key, 'row-0');
    assert.equal(value.id, 'row-0');
    counts[name]++;
    const cost = current[name] === value ? .001 : singleCost * (name === 'large' ? largeFactor : 1);
    elapsed += tooFast ? 0 : cost;
    current[name] = value;
    // Keep only a count and endpoints per interval, not every operation.
    if (pending.length && pending.at(-1).name === name) {
      pending.at(-1).count++;
      pending.at(-1).last = value.label;
    } else pending.push({ name, count: 1, first: value.label, last: value.label });
  } }]));
  const context = {
    window: { __indexed: handles },
    performance: { now() {
      clockCalls++;
      elapsed += underresolved && clockCalls === 2 ? 500 : .01;
      if (pending.length) { intervals.push(...pending); pending = []; }
      return Math.floor(elapsed / .1) * .1;
    } },
    document: { querySelectorAll(selector) {
      if (selector === '#small li') return Array(200);
      if (selector === '#large li') return Array(2000);
      assert.equal(selector, '#small li:first-child b, #large li:first-child b');
      return ['small', 'large'].map(name => ({ textContent: current[name]?.label }));
    } },
  };
  const report = runInNewContext(`(${measureIndexedPublicSet.toString()})()`, context);
  // Normalize VM realm prototypes for Node's strict assertion semantics.
  return { report: JSON.parse(JSON.stringify(report)), counts, intervals };
}

test('fixed calibration resolves >=512 ticks and 32ms before all101 alternating pairs; work stays complete', () => {
  const { report: r, counts, intervals } = collect();
  assert.equal(r.clock.resolved, true);
  assert.ok(Math.abs(r.clock.resolution - .1) < 1e-9);
  assert.ok(Math.abs(r.clock.targetDuration - 51.2) < 1e-8);
  assert.equal(r.batch, 4096);
  assert.ok(r.clock.calibration.slice(0, -1).every(v => Math.min(v.small, v.large) < r.clock.targetDuration));
  assert.ok(Math.min(r.clock.calibration.at(-1).small, r.clock.calibration.at(-1).large) >= r.clock.targetDuration);
  assert.equal(r.rounds, 101);
  for (const name of ['small', 'large']) {
    assert.equal(r.samples[name].length, 101);
    assert.equal(r.noOp[name].length, 101);
    assert.equal(counts[name], 5000 + r.clock.calibration.reduce((sum, v) => sum + v.batch, 0) + 101 * (2 * r.batch + 2));
  }
  const batches = intervals.filter(v => v.count === r.batch);
  const pairedOrder = Array.from({ length: 101 }, (_, i) => i % 2 ? ['large', 'small'] : ['small', 'large']).flat();
  assert.deepEqual(batches.map(v => v.name), ['small', 'large', ...pairedOrder, ...Array(101).fill(['small', 'large']).flat()]);
  assert.ok(batches.slice(2, 204).every(v => v.first === 'Timing A' && v.last === 'Timing B'));
  assert.ok(batches.slice(204).every(v => v.first === 'Timing B' && v.last === 'Timing B'));
  assert.deepEqual(r.rows, [200, 2000]);
  assert.deepEqual(r.labels, ['Timing B', 'Timing B']);
  assert.ok(r.summary.large.median <= r.summary.small.median * 1.1);
  assert.ok(r.summary.large.p95 <= r.summary.small.p95 * 1.1);
  assert.ok(r.maximumSingle < 16);
});

test('a real20% increase in each large public operation remains outside both unchanged10% constraints', () => {
  const { report: r } = collect({ largeFactor: 1.2 });
  assert.equal(r.clock.resolved, true);
  assert.equal(r.rounds, 101);
  assert.ok(r.summary.large.median > r.summary.small.median * 1.1);
  assert.ok(r.summary.large.p95 > r.summary.small.p95 * 1.1);
});

test('linear200→2000 operation cost remains rejected even though both use one calibrated batch', () => {
  const { report: r } = collect({ largeFactor: 2000 / 200 });
  assert.equal(r.clock.resolved, true);
  assert.equal(r.samples.small.length, 101);
  assert.equal(r.samples.large.length, 101);
  assert.ok(r.summary.large.median > r.summary.small.median * 9);
  assert.ok(r.summary.large.p95 > r.summary.small.p95 * 9);
});

test('an absolute17ms public operation still exceeds the separate16ms frame constraint', () => {
  const { report: r } = collect({ singleCost: 17 });
  assert.equal(r.clock.resolved, true);
  assert.ok(r.maximumSingle >= 17);
  assert.ok(r.summary.large.p95 >= 17);
});

test('insufficient clock observations retain calibration but produce no acceptance samples', () => {
  const { report: r } = collect({ underresolved: true });
  assert.equal(r.clock.resolved, false);
  assert.ok(r.clock.ticks.length < 16);
  assert.ok(r.clock.calibration.length > 0);
  assert.equal(r.rounds, 0);
  assert.deepEqual(r.samples, { small: [], large: [] });
});

test('maximum batch exhaustion retains the bounded attempt and does not retry unresolved sampling', () => {
  const { report: r } = collect({ tooFast: true });
  assert.equal(r.batch, 1_048_576);
  assert.equal(r.clock.maximumBatch, 1_048_576);
  assert.equal(r.clock.calibration.length, 13);
  assert.equal(r.clock.resolved, false);
  assert.equal(r.rounds, 0);
  assert.deepEqual(r.samples, { small: [], large: [] });
});
