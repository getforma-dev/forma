// One car in one fresh process: correctness first, then warm-up and timed rounds. Prints one JSON line.
import { correctness } from './correctness.mjs';
import { BENCHES, getSink } from './benchmarks.mjs';
import { count, validateCars, rate } from './validation.mjs';
let processAffinity = null;
if (process.env.GP_RESOURCE_PROFILE) {
  const { validateProfile, verifyRoleAffinity } = await import('../harness/resource-profile.mjs');
  processAffinity = verifyRoleAffinity(validateProfile(JSON.parse(process.env.GP_RESOURCE_PROFILE)), 'signals');
}

const [car, warm = '2', runs = '5'] = process.argv.slice(2);
validateCars([car]); count(warm, 'warmups'); count(runs, 'runs', 1);
const lib = (await import(`./adapters/${car}.mjs`)).default;
const checks = correctness(lib);
const out = { car, library: lib.name, version: lib.version, node: process.version, processAffinity, checks, correct: checks.every((c) => c.ok), benches: {} };
if (out.correct) {
  for (let r = 0; r < +warm + +runs; r++) {
    for (const b of BENCHES) {
      globalThis.gc?.();
      const { n, ms } = b.run(lib);
      const measured = rate(n, ms);
      if (r >= +warm) (out.benches[b.name] ??= { runs: [] }).runs.push(measured);
    }
  }
  for (const [name, b] of Object.entries(out.benches)) {
    b.unit = 'ops/s'; b.comparable = !(lib.noBatch && name === 'batch of 100 writes');
    if (!b.comparable) b.note = 'No public batch API; uncoalesced writes are not equivalent batching work.';
    const xs = b.runs; b.mean = xs.reduce((a, c) => a + c, 0) / xs.length;
    b.sd = Math.sqrt(xs.reduce((a, c) => a + (c - b.mean) ** 2, 0) / Math.max(1, xs.length - 1));
  }
  out.geomeanOpsPerSec = Math.exp(Object.values(out.benches).reduce((a, b) => a + Math.log(b.mean), 0) / BENCHES.length);
}
out.noBatch = !!lib.noBatch;
out.geomeanComparable = !lib.noBatch;
if (lib.noBatch) out.comparisonNote = 'The legacy geomean includes uncoalesced batching. Compare individual equivalent workloads; do not rank aggregate against batched adapters.';
out.sink = getSink() > 0;
console.log(JSON.stringify(out));
