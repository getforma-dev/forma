import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureIndexedPublicSet } from './indexed-timing.ts';
import { createIndexedProgressWriter } from './indexed-progress.mjs';
import { assertIndexedPublicSetTiming } from './indexed-timing-acceptance.mjs';

// Run the exact serialized browser collector. The synthetic public operation
// advances a quantized clock by a known cost, retaining identity no-ops; no
// real browser time or product performance is inferred from these controls.
async function collect({ largeFactor = 1, largeRoundFactor = () => 1, singleCost = .02, resolution = .1, underresolved = false, tooFast = false, messages = [], failAfterPairs = false, pauseCost = 0 } = {}) {
  let elapsed = 0, clockCalls = 0, pausedElapsed = 0, lastProgress, pairedRound;
  const pauses = [];
  let failed = false, pausePending = false;
  const counts = { small: 0, large: 0 }, current = {}, intervals = [];
  let pending = [];
  const handles = Object.fromEntries(['small', 'large'].map(name => [name, { set(key, value) {
    assert.equal(pausePending, false, 'public operation ran before the task opportunity completed');
    if (failed) throw new Error('synthetic operation refusal');
    assert.equal(key, 'row-0');
    assert.equal(value.id, 'row-0');
    counts[name]++;
    const roundFactor = pairedRound === undefined ? 1 : largeRoundFactor(pairedRound);
    const cost = current[name] === value ? .001 : singleCost * (name === 'large' ? largeFactor * roundFactor : 1);
    elapsed += tooFast ? 0 : cost;
    current[name] = value;
    // Keep only a count and endpoints per interval, not every operation.
    if (pending.length && pending.at(-1).name === name) {
      pending.at(-1).count++;
      pending.at(-1).last = value.label;
    } else pending.push({ name, count: 1, first: value.label, last: value.label });
  } }]));
  const context = {
    console: { debug(text) {
      messages.push(text);
      const row = JSON.parse(text.slice('[forma:indexed-progress] '.length));
      lastProgress = row;
      if (row.phase === 'paired') pairedRound = 0;
      if (row.phase === 'paired-row') pairedRound = row.round + 1;
      if (row.phase === 'noop') pairedRound = undefined;
      if (failAfterPairs && row.phase === 'paired-row' && row.round === 1) failed = true;
    } },
    setTimeout(callback, delay) {
      assert.equal(delay, 0);
      pauses.push({ phase: lastProgress?.phase, round: lastProgress?.round, counts: { ...counts } });
      assert.equal(pausePending, false);
      pausePending = true;
      // Synthetic async task completion; no real browser-time claim.
      queueMicrotask(() => { pausedElapsed += pauseCost; pausePending = false; callback(); });
    },
    navigator: { userAgent: 'deterministic collector control; not a browser' },
    window: { __indexed: handles },
    performance: { now() {
      assert.equal(pausePending, false, 'clock read before the task opportunity completed');
      clockCalls++;
      elapsed += underresolved && clockCalls === 2 ? 500 : .01;
      if (pending.length) { intervals.push(...pending); pending = []; }
      return Math.floor(elapsed / resolution) * resolution + pausedElapsed;
    } },
    document: { querySelectorAll(selector) {
      if (selector === '#small li') return Array(200);
      if (selector === '#large li') return Array(2000);
      assert.equal(selector, '#small li:first-child b, #large li:first-child b');
      return ['small', 'large'].map(name => ({ textContent: current[name]?.label }));
    } },
  };
  const report = await runInNewContext(`(${measureIndexedPublicSet.toString()})()`, context);
  // Normalize VM realm prototypes for Node's strict assertion semantics.
  return { report: JSON.parse(JSON.stringify(report)), counts, intervals, messages, pauses };
}

test('fixed calibration resolves >=512 ticks and 32 ms before all 101 alternating pairs; work stays complete', async () => {
  const { report: r, counts, intervals } = await collect();
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
  const scaling = assertIndexedPublicSetTiming(r);
  for (const name of ['small', 'large']) {
    const totalElapsed = r.samples[name].reduce((sum, value) => sum + value * r.batch, 0);
    assert.equal(scaling[`${name}MeanMs`], totalElapsed / (101 * r.batch));
  }
});

test('exactly 202 async task opportunities follow complete pairs and their synthetic clock cost stays outside every measurement', async () => {
  const baseline = await collect();
  const { report: r, counts, pauses } = await collect({ pauseCost: 1000 });
  assert.equal(pauses.length, 202);
  const setup = 5000 + r.clock.calibration.reduce((sum, row) => sum + row.batch, 0);
  for (let round = 0; round < 101; round++) {
    const edits = setup + (round + 1) * (r.batch + 2);
    assert.deepEqual(pauses[round], { phase: 'paired-row', round, counts: { small: edits, large: edits } });
    const noops = setup + 101 * (r.batch + 2) + (round + 1) * r.batch;
    assert.deepEqual(pauses[101 + round], { phase: 'noop-row', round, counts: { small: noops, large: noops } });
  }
  assert.deepEqual(counts, baseline.counts);
  assert.deepEqual(r.clock, baseline.report.clock);
  for (const phase of ['samples', 'noOp']) for (const name of ['small', 'large']) {
    assert.equal(r[phase][name].length, 101);
    for (let i = 0; i < 101; i++) assert.ok(Math.abs(r[phase][name][i] - baseline.report[phase][name][i]) < 1e-10, `${phase}/${name}/${i}: pause entered timing`);
  }
  assert.ok(Math.abs(r.maximumSingle - baseline.report.maximumSingle) < 1e-8);
});

test('synthetic 20% per-operation large-case cost fails the actual 10% amortized acceptance seam', async () => {
  const { report: r } = await collect({ largeFactor: 1.2 });
  assert.equal(r.clock.resolved, true);
  assert.equal(r.rounds, 101);
  assert.ok(r.summary.large.median > r.summary.small.median * 1.1);
  assert.ok(r.summary.large.p95 > r.summary.small.p95 * 1.1);
  assert.throws(() => assertIndexedPublicSetTiming(r), /exceeds 10% scaling/);
});

test('synthetic linear 200→2000 cost remains rejected with one calibrated batch', async () => {
  const { report: r } = await collect({ largeFactor: 2000 / 200 });
  assert.equal(r.clock.resolved, true);
  assert.equal(r.samples.small.length, 101);
  assert.equal(r.samples.large.length, 101);
  assert.ok(r.summary.large.median > r.summary.small.median * 9);
  assert.ok(r.summary.large.p95 > r.summary.small.p95 * 9);
  assert.throws(() => assertIndexedPublicSetTiming(r), /exceeds 10% scaling/);
});

test('synthetic 17 ms public-operation cost exceeds the separate 16 ms constraint', async () => {
  const { report: r } = await collect({ singleCost: 17 });
  assert.equal(r.clock.resolved, true);
  assert.ok(r.maximumSingle >= 17);
  assert.ok(r.summary.large.p95 >= 17);
  assert.throws(() => assertIndexedPublicSetTiming(r), /sampled single public set must stay below 16 ms/);
});

test('explicit tradeoff: six doubled-cost rounds fail the old marginal p95 ratio but pass the all-cost mean', async t => {
  const doubled = new Set([0, 17, 34, 51, 68, 85]);
  const { report: r } = await collect({ largeRoundFactor: round => doubled.has(round) ? 2 : 1 });
  const original = JSON.stringify(r);
  assert.equal(r.samples.large.filter((value, i) => value > r.samples.small[i] * 1.5).length, 6);
  assert.ok(r.summary.large.p95 > r.summary.small.p95 * 1.1, 'the old p95 oracle would reject these real cost tails');
  const scaling = assertIndexedPublicSetTiming(r);
  assert.ok(Math.abs(scaling.ratio - 107 / 101) < .001);
  assert.equal(JSON.stringify(r), original, 'acceptance cannot trim or rewrite the retained raw report');
  t.diagnostic(JSON.stringify({ synthetic: true, oldP95Ratio: r.summary.large.p95 / r.summary.small.p95, ...scaling }));
});

test('all costs remain: one twentyfold round fails the mean despite passing both old marginal relative gates', async t => {
  const { report: r } = await collect({ largeRoundFactor: round => round === 50 ? 20 : 1 });
  assert.ok(r.summary.large.median <= r.summary.small.median * 1.1);
  assert.ok(r.summary.large.p95 <= r.summary.small.p95 * 1.1);
  assert.equal(r.samples.large.filter((value, i) => value > r.samples.small[i] * 10).length, 1);
  assert.throws(() => assertIndexedPublicSetTiming(r), /exceeds 10% scaling/);
  t.diagnostic(JSON.stringify({ synthetic: true, oldP95Ratio: r.summary.large.p95 / r.summary.small.p95, proposedMeanRatio: r.samples.large.reduce((a, b) => a + b) / r.samples.small.reduce((a, b) => a + b) }));
});

test('the actual acceptance seam rejects missing and nonfinite costs instead of ignoring them', async () => {
  const { report: r } = await collect();
  for (const invalid of [NaN, Infinity, -1]) {
    const changed = structuredClone(r); changed.samples.large[100] = invalid;
    assert.throws(() => assertIndexedPublicSetTiming(changed), /finite and nonnegative/);
  }
  r.samples.large.pop();
  assert.throws(() => assertIndexedPublicSetTiming(r), /every edit batch must contribute/);
});

test('insufficient clock observations retain calibration but produce no acceptance samples', async () => {
  const { report: r, pauses } = await collect({ underresolved: true });
  assert.equal(pauses.length, 0);
  assert.equal(r.clock.resolved, false);
  assert.ok(r.clock.ticks.length < 16);
  assert.ok(r.clock.calibration.length > 0);
  assert.equal(r.rounds, 0);
  assert.deepEqual(r.samples, { small: [], large: [] });
  assert.throws(() => assertIndexedPublicSetTiming(r), /clock resolution is insufficient/);
});

test('maximum batch exhaustion retains the bounded attempt and does not retry unresolved sampling', async () => {
  const { report: r, messages, pauses } = await collect({ tooFast: true });
  assert.equal(pauses.length, 0);
  assert.equal(r.batch, 1_048_576);
  assert.equal(r.clock.maximumBatch, 1_048_576);
  assert.equal(r.clock.calibration.length, 13);
  assert.equal(r.clock.resolved, false);
  assert.equal(r.rounds, 0);
  assert.deepEqual(r.samples, { small: [], large: [] });
  const progress = messages.map(text => JSON.parse(text.slice('[forma:indexed-progress] '.length)));
  assert.equal(progress.filter(row => row.phase === 'calibration').length, 13);
  assert.equal(progress.filter(row => row.phase === 'paired-row' || row.phase === 'noop-row').length, 0);
  assert.deepEqual(progress.at(-1), { phase: 'complete', rounds: 0, batch: 1_048_576, resolved: false });
  assert.throws(() => assertIndexedPublicSetTiming(r), /clock resolution is insufficient/);
});

test('a synthetic 1ms clock retains512ms calibration, all101 original pairs/no-ops and unchanged public work', async () => {
  const { report: r, counts, intervals, messages } = await collect({ resolution: 1, singleCost: .2 });
  assert.equal(r.clock.resolution, 1); assert.equal(r.clock.targetDuration, 512);
  assert.equal(r.clock.resolved, true); assert.equal(r.rounds, 101);
  for (const name of ['small', 'large']) {
    assert.equal(counts[name], 5000 + r.clock.calibration.reduce((sum, row) => sum + row.batch, 0) + 101 * (2 * r.batch + 2));
    assert.equal(r.samples[name].length, 101); assert.equal(r.noOp[name].length, 101);
  }
  const batches = intervals.filter(row => row.count === r.batch);
  assert.deepEqual(batches.map(row => row.name), ['small', 'large', ...Array.from({ length: 101 }, (_, i) => i % 2 ? ['large', 'small'] : ['small', 'large']).flat(), ...Array(101).fill(['small', 'large']).flat()]);
  const progress = messages.map(text => JSON.parse(text.slice('[forma:indexed-progress] '.length)));
  assert.deepEqual(progress.find(row => row.phase === 'clock'), { phase: 'clock', ticks: r.clock.ticks, resolution: 1, targetDuration: 512 });
  for (const [phase, samples] of [['paired-row', r.samples], ['noop-row', r.noOp]]) {
    const rows = progress.filter(row => row.phase === phase);
    assert.equal(rows.length, 101);
    assert.deepEqual(rows.map(row => row.round), Array.from({ length: 101 }, (_, i) => i));
    for (const name of ['small', 'large']) assert.deepEqual(rows.map(row => row[name]), samples[name]);
  }
  assert(messages.length <= 256);
  assert(Buffer.byteLength(messages.join('\n')) < 128 * 1024);
});

test('actual progress writer preserves partial original observations on refusal and fails bounded malformed/overflow evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forma-indexed-progress-'));
  try {
    const messages = [];
    await assert.rejects(collect({ singleCost: .2, messages, failAfterPairs: true }), /synthetic operation refusal/);
    const path = join(directory, 'partial.jsonl'), write = createIndexedProgressWriter(path);
    for (const message of messages) write(message);
    const rows = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.filter(row => row.phase === 'paired-row').length, 2);
    assert(!rows.some(row => row.phase === 'complete'));
    const bytes = statSync(path).size;
    write('unrelated browser log'); assert.equal(statSync(path).size, bytes);
    assert.throws(() => write('[forma:indexed-progress] ' + 'x'.repeat(128 * 1024)), /evidence limit/);
    assert.equal(statSync(path).size, bytes);
    assert.throws(() => write('[forma:indexed-progress] invalid-json'), SyntaxError);
    assert(readFileSync(path, 'utf8').endsWith('invalid-json\n'), 'malformed original record retained before refusal');
    const countPath = join(directory, 'count.jsonl'), countWrite = createIndexedProgressWriter(countPath);
    for (let i = 0; i < 256; i++) countWrite('[forma:indexed-progress] {"phase":"synthetic"}');
    assert.throws(() => countWrite('[forma:indexed-progress] {"phase":"extra"}'), /evidence limit/);
    const spec = readFileSync(new URL('./indexed-products.spec.ts', import.meta.url), 'utf8');
    assert.equal((spec.match(/test\.setTimeout\(300_000\)/g) ?? []).length, 1);
    assert(spec.indexOf('test.setTimeout(300_000)') > spec.indexOf("test('indexed products: complete public set"));
    assert(spec.includes('test.setTimeout(60_000)'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
