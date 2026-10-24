// The FORMA-254 nine-benchmark protocol, against the exact installed dependency.
// Run each adapter in a fresh process; --entry can point at a preserved baseline.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { correctness } from './correctness.mjs';
import { BENCHES, getSink } from './benchmarks.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const entry = option('--entry', new URL('../../dist/index.js', import.meta.url).pathname);
const warm = Number(option('--warm', '5')), runs = Number(option('--runs', '9'));
const car = option('--worker', '');
if (!car) {
  const results = ['forma', 'alien'].map(name => {
    const result = spawnSync(process.execPath, ['--expose-gc', ...process.execArgv.filter(a => a.startsWith('--cpu-prof')), import.meta.filename, '--worker', name, '--entry', entry, '--warm', String(warm), '--runs', String(runs)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  });
  const ratios = Object.fromEntries(BENCHES.map(({name}) => [name, results[0].benches[name].mean / results[1].benches[name].mean]));
  console.log(JSON.stringify({ results, ratios, geomeanRatio: results[0].geomeanOpsPerSec / results[1].geomeanOpsPerSec }, null, 2));
} else {
  const source = car === 'forma' ? await import(pathToFileURL(resolve(entry))) : await import('alien-signals');
  const lib = car === 'forma' ? {
    signal(value) { const [get, set] = source.createSignal(value); return {get, set}; },
    computed(fn) { return {get: source.createComputed(fn)}; },
    effect: source.createEffect, batch: source.batch,
  } : {
    signal(value) { const get = source.signal(value); return {get, set: value => get(value)}; },
    computed(fn) { return {get: source.computed(fn)}; },
    effect: source.effect,
    batch(fn) { source.startBatch(); try { return fn(); } finally { source.endBatch(); } },
  };
  const checks = correctness(lib);
  if (checks.some(check => !check.ok)) throw new Error(JSON.stringify(checks));
  const out = { car, node: process.version, dependency: JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('alien-signals')))).version, entry, checks, benches: {} };
  for (let round = 0; round < warm + runs; round++) for (const bench of BENCHES) {
    globalThis.gc?.();
    const {n, ms} = bench.run(lib);
    if (round >= warm) (out.benches[bench.name] ??= {runs: []}).runs.push(n / (ms / 1000));
  }
  for (const result of Object.values(out.benches)) {
    result.mean = result.runs.reduce((a, b) => a + b, 0) / runs;
    result.sd = Math.sqrt(result.runs.reduce((a, b) => a + (b - result.mean) ** 2, 0) / Math.max(1, runs - 1));
  }
  out.geomeanOpsPerSec = Math.exp(Object.values(out.benches).reduce((a, b) => a + Math.log(b.mean), 0) / BENCHES.length);
  out.sink = getSink() > 0;
  console.log(JSON.stringify(out));
}
