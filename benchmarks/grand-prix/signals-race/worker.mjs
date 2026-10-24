// One car in one fresh process: correctness first, then warm-up and timed rounds. Prints one JSON line.
import { correctness } from './correctness.mjs';
import { BENCHES, getSink } from './benchmarks.mjs';

const [car, warm = '2', runs = '5'] = process.argv.slice(2);
const lib = (await import(`./adapters/${car}.mjs`)).default;
const checks = correctness(lib);
const out = { car, library: lib.name, version: lib.version, node: process.version, checks, correct: checks.every((c) => c.ok), benches: {} };
if (out.correct) {
  for (let r = 0; r < +warm + +runs; r++) {
    for (const b of BENCHES) {
      globalThis.gc?.();
      const { n, ms } = b.run(lib);
      if (r >= +warm) (out.benches[b.name] ??= { runs: [] }).runs.push(n / (ms / 1000));
    }
  }
  for (const b of Object.values(out.benches)) {
    const xs = b.runs; b.mean = xs.reduce((a, c) => a + c, 0) / xs.length;
    b.sd = Math.sqrt(xs.reduce((a, c) => a + (c - b.mean) ** 2, 0) / Math.max(1, xs.length - 1));
  }
  out.geomeanOpsPerSec = Math.exp(Object.values(out.benches).reduce((a, b) => a + Math.log(b.mean), 0) / BENCHES.length);
}
out.sink = getSink() > 0;
console.log(JSON.stringify(out));
