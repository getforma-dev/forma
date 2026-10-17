import assert from 'node:assert/strict';

export const indexedRelativeMetric = 'all-101-amortized-public-set-v1';

/** @param {Awaited<ReturnType<typeof import('./indexed-timing.ts').measureIndexedPublicSet>>} report */
export function assertIndexedPublicSetTiming(report) {
  assert.equal(report.clock.resolved, true, 'clock resolution is insufficient at the bounded maximum batch; no timing acceptance is possible');
  assert.equal(report.rounds, 101);
  assert.deepEqual(report.rows, [200, 2000]);
  assert.deepEqual(report.labels, ['Timing B', 'Timing B']);
  assert(report.summary.small.median > 0, 'small-case median must be positive');
  assert(report.maximumSingle < 16, `sampled single public set must stay below 16 ms: ${report.maximumSingle}`);
  assert(report.summary.large.p95 < 16, `large batch-mean p95 must stay below 16 ms: ${report.summary.large.p95}`);
  assert(Number.isSafeInteger(report.batch) && report.batch > 0, 'shared batch must be a positive integer');
  /** @param {number[]} samples */
  const mean = (samples) => {
    assert.equal(samples.length, 101, 'every edit batch must contribute to the mean');
    assert(samples.every(value => Number.isFinite(value) && value >= 0), 'edit batch costs must be finite and nonnegative');
    // All batches contain the same number of edits: sum(sample * batch) /
    // (101 * batch) equals this mean. No trimming or no-op subtraction.
    return samples.reduce((total, value) => total + value, 0) / 101;
  };
  const smallMeanMs = mean(report.samples.small), largeMeanMs = mean(report.samples.large);
  assert(Number.isFinite(smallMeanMs) && smallMeanMs > 0, 'small mean must be finite and positive');
  assert(Number.isFinite(largeMeanMs) && largeMeanMs < 16, `large amortized public set must stay below 16 ms: ${largeMeanMs}`);
  const ratio = largeMeanMs / smallMeanMs;
  assert(largeMeanMs <= smallMeanMs * 1.1, `amortized public set exceeds 10% scaling: small=${smallMeanMs} ms, large=${largeMeanMs} ms, ratio=${ratio}`);
  // The old marginal median/p95 summaries remain descriptive in the raw report.
  // This is warmed complete-public-set cost, not individual-edit latency p95.
  return { metric: indexedRelativeMetric, smallMeanMs, largeMeanMs, ratio };
}
