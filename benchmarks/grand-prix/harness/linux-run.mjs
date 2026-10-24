// One owned, sequential Linux run. No resource outside this run is pruned.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCars, BASELINE_SOURCE } from './prepare-car.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback;
const allCars = ['forma', 'vanilla-node', 'react-node', 'preact-node', 'solid-node', 'svelte-node', 'vue-node',
  'react-bun', 'vanilla-bun', 'react-deno', 'vanilla-deno', 'next', 'react-router', 'astro'];
const cars = option('cars', allCars.join(',')).split(',');
assert(cars.length && new Set(cars).size === cars.length && cars.every(car => allCars.includes(car)), 'invalid car set');
const events = option('events', '1-8');
assert(/^[1-8,-]+$/.test(events), 'server event selector must use 1–8');
const diagnostic = argv.includes('--diagnostic');
const baseline = argv.includes('--baseline');
const formaRef = option('forma-ref', undefined);
assert.equal(process.platform, 'linux', 'this runner is for native Linux');
if (!diagnostic) assert(os.availableParallelism() >= 8, 'baseline needs eight CPUs; --diagnostic cannot qualify the Linux baseline');
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' });
assert.equal(dirty.trim(), '', 'commit all benchmark and framework source before racing');
const id = process.env.GP_RUN_ID || `r${Date.now().toString(36)}-${process.pid}`;
assert(/^[a-z0-9-]+$/.test(id), 'invalid run ID');
process.env.GP_RUN_ID = id;
process.env.GP_IMAGE_PREFIX = `gp264/${id}`;
const imageName = car => `${process.env.GP_IMAGE_PREFIX}/${car}`;
const builder = `gp264-${id}`;
const label = `gp264run=${id}`;
const results = join(root, 'results');
mkdirSync(results, { recursive: true });
assert(!existsSync(join(results, 'raw')), 'fresh raw directory required; archive prior evidence first');
const ownershipPath = join(results, `${id}-ownership.json`);
assert(!existsSync(ownershipPath), 'run ID already used');
const ownership = { id, builder, builderCreated: false };
const report = { schema: 1, id, diagnostic, cars, events, platform: process.platform, arch: process.arch,
  carSource: baseline ? BASELINE_SOURCE : 'current checkout', formaRef: formaRef ?? 'published 3.0.0',
  cpus: os.availableParallelism(), cpu: os.cpus()[0]?.model, kernel: os.release(), memoryBytes: os.totalmem(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  before: new Date().toISOString(), freeBefore: free(), steps: [], passed: false };
const save = () => writeFileSync(join(results, `${id}-linux.json`), JSON.stringify(report, null, 2) + '\n');
function free() { const stat = statfsSync(root); return stat.bavail * stat.bsize; }
function checkDisk() { assert(free() >= 4 * 1024 ** 3, 'free disk below 4 GiB; stop before another build'); }
let child;
function run(program, args, cwd = root) {
  console.log(JSON.stringify([program, ...args]));
  return new Promise((ok, fail) => {
    child = spawn(program, args, { cwd, stdio: 'inherit', env: process.env });
    child.once('error', fail);
    child.once('close', code => { child = undefined; code === 0 ? ok() : fail(new Error(`${program} exited ${code}`)); });
  });
}
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(signal); });
async function quiet() {
  const deadline = Date.now() + 5 * 60_000;
  while (os.loadavg()[0] >= 2 && Date.now() < deadline && !stopping) {
    console.log(`settling after build; load=${os.loadavg()[0].toFixed(2)}`);
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  assert(!stopping, 'run interrupted');
  assert(os.loadavg()[0] < 2, 'machine did not settle below load 2');
}
const buildArgs = ['buildx', 'build', '--builder', builder, '--load', '--label', 'grandprix=forma-264', '--label', label];
async function build(car, context) {
  checkDisk();
  await run('docker', [...buildArgs, '-t', imageName(car), context]);
  await run('docker', [...buildArgs, '--target', 'build', '-t', imageName(car + '-build'), context]);
}
try {
  checkDisk();
  const contexts = prepareCars(root, join(results, `${id}-contexts`), { baseline, formaRef });
  await run('docker', ['buildx', 'create', '--name', builder, '--driver', 'docker-container']);
  ownership.builderCreated = true;
  writeFileSync(ownershipPath, JSON.stringify(ownership));
  await run('docker', [...buildArgs, '-t', imageName('loadgen'), 'harness/loadgen']);
  for (const car of cars) {
    await build(car, join(contexts, car));
    if (car === 'forma') {
      const bytes = execFileSync('docker', ['run', '--rm', '--label', label, imageName('forma-build'),
        'stat', '-c', '%s', '/app/target/release/grandprix-forma'], { encoding: 'utf8' }).trim();
      report.releaseBinaryBytes = Number(bytes);
      if (formaRef) writeFileSync(join(results, `${id}-forma-Cargo.lock`),
        execFileSync('docker', ['run', '--rm', '--label', label, imageName('forma-build'), 'cat', '/app/Cargo.lock']));
    }
    await quiet();
    const before = { car, at: new Date().toISOString(), load: os.loadavg(), freeBytes: free() };
    await run(process.execPath, ['harness/race.mjs', '--cars', car, '--events', events]);
    report.steps.push({ ...before, finished: new Date().toISOString(), loadAfter: os.loadavg() }); save();
    // Remove only images just built by this run, and this run's builder cache.
    await run('docker', ['image', 'rm', imageName(car), imageName(car + '-build')]);
    await run('docker', ['buildx', 'prune', '--builder', builder, '--all', '--force']);
    checkDisk();
  }
  report.passed = true;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  save();
  try { await run(process.execPath, ['harness/cleanup.mjs']); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  report.freeAfter = free(); report.finished = new Date().toISOString(); save();
}
