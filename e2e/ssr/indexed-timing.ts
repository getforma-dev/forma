// Browser-serializable collection only. The actual public handles and DOM are
// supplied by the built indexed fixture; deterministic controls exercise this
// same function with a clock and handles whose work is known. Acceptance remains
// in indexed-products.spec.ts; calibration never examines a relative result.
export async function measureIndexedPublicSet() {
  // Diagnostic emission is synchronous and does not reorder operations.
  // Node retains each completed row before its between-pair task opportunity.
  const progress = (row: object) => console.debug('[forma:indexed-progress] ' + JSON.stringify(row));
  progress({ phase: 'warmup', operationsPerOwner: 5000 });
  const handles = (window as any).__indexed;
  const values = [{ id: 'row-0', label: 'Timing A' }, { id: 'row-0', label: 'Timing B' }];
  const samples = { small: [] as number[], large: [] as number[] };
  let maximumSingle = 0;
  // Prebuild next-item values outside timing; the measured operation is the
  // actual public handle.set, including lookup, key validation and DOM effects.
  for (let i = 0; i < 5000; i++) { handles.small.set('row-0', values[i % 2]); handles.large.set('row-0', values[i % 2]); }
  // Measure clock granularity before choosing one shared batch size. This is
  // calibration, not acceptance sampling: no ratio or result drives retries.
  let previous = performance.now();
  const ticks: number[] = [], clockBegan = previous;
  while (ticks.length < 16 && performance.now() - clockBegan < 250) {
    const now = performance.now();
    if (now > previous) { ticks.push(now - previous); previous = now; }
  }
  const clockResolution = ticks.length ? Math.min(...ticks) : 0;
  const targetDuration = Math.max(32, 512 * clockResolution);
  progress({ phase: 'clock', ticks, resolution: clockResolution, targetDuration });
  let batch = 256;
  const maximumBatch = 1_048_576, calibration: { batch: number; small: number; large: number }[] = [];
  for (;;) {
    const elapsed = { batch, small: 0, large: 0 };
    for (const name of ['small', 'large'] as const) {
      const began = performance.now();
      for (let i = 0; i < batch; i++) handles[name].set('row-0', values[i % 2]);
      elapsed[name] = performance.now() - began;
    }
    calibration.push(elapsed);
    progress({ phase: 'calibration', ...elapsed });
    if (Math.min(elapsed.small, elapsed.large) >= targetDuration || batch === maximumBatch) break;
    batch *= 2;
  }
  const resolved = clockResolution > 0 && ticks.length === 16
    && Math.min(calibration.at(-1)!.small, calibration.at(-1)!.large) >= targetDuration;
  const rounds = resolved ? 101 : 0;
  progress({ phase: 'paired', resolved, batch, rounds });
  for (let round = 0; round < rounds; round++) {
    // Alternate order to avoid assigning every earlier/JIT/GC slot to one size.
    for (const name of (round % 2 ? ['large', 'small'] : ['small', 'large']) as ('small' | 'large')[]) {
      const began = performance.now();
      for (let i = 0; i < batch; i++) handles[name].set('row-0', values[i % 2]);
      samples[name].push((performance.now() - began) / batch);
      const single = performance.now(); handles[name].set('row-0', values[0]);
      maximumSingle = Math.max(maximumSingle, performance.now() - single);
      handles[name].set('row-0', values[1]);
    }
    progress({ phase: 'paired-row', round, small: samples.small.at(-1), large: samples.large.at(-1), maximumSingle });
    // Give browser tasks an opportunity only after the complete pair. Neither
    // owner's measured batch or single-operation check includes this pause.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]!;
  const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { median: quantile(values, 0.5), p95: quantile(values, 0.95) }])) as Record<'small' | 'large', { median: number; p95: number }>;
  const noOp = { small: [] as number[], large: [] as number[] };
  progress({ phase: 'noop', batch, rounds });
  for (let round = 0; round < rounds; round++) {
    for (const name of ['small', 'large'] as const) {
      const began = performance.now();
      for (let i = 0; i < batch; i++) handles[name].set('row-0', values[1]);
      noOp[name].push((performance.now() - began) / batch);
    }
    progress({ phase: 'noop-row', round, small: noOp.small.at(-1), large: noOp.large.at(-1) });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  progress({ phase: 'complete', rounds, batch, resolved });
  const spread = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { min: Math.min(...values), p05: quantile(values, 0.05), max: Math.max(...values) }]));
  return { noOp, spread, clock: { ticks, resolution: clockResolution, targetDuration, maximumBatch, calibration, resolved }, protocol: '101 alternating paired samples of one shared calibrated batch; each sample is mean complete public set duration including synchronous DOM writes; 5000 warmup edits per owner; clock calibration seeks at least 512 ticks and 32ms per batch; one fixed setTimeout(0) task opportunity only after each complete edit pair and no-op pair (202 when resolved), outside measured intervals; no acceptance retries; single-operation maxima sampled separately', batch, rounds, samples, summary, maximumSingle, rows: [document.querySelectorAll('#small li').length, document.querySelectorAll('#large li').length], labels: [...document.querySelectorAll('#small li:first-child b, #large li:first-child b')].map(node => node.textContent), userAgent: navigator.userAgent };
}
