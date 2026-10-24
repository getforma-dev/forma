// Event 11. Usage: node run.mjs [--cars forma,solid] [--runs 5] [--warmups 2] [--out ../results/raw/signals]
// In Docker (image gp264/signals) the default output is /out: mount the host's results/raw/signals there.
// Each car runs in a fresh child process, one after another.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARS } from './cars.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const out = arg('out', process.env.GP_OUT || (existsSync('/.dockerenv') ? '/out' : path.join(here, '..', 'results', 'raw', 'signals')));
const cars = arg('cars', CARS.join(',')).split(',');
const runs = arg('runs', '5'), warm = arg('warmups', '2');
let resourceProfile = null, processAffinity = null;
if (process.env.GP_RESOURCE_PROFILE) {
  const { validateProfile, verifyRoleAffinity } = await import('../harness/resource-profile.mjs');
  resourceProfile = validateProfile(JSON.parse(process.env.GP_RESOURCE_PROFILE));
  processAffinity = verifyRoleAffinity(resourceProfile, 'signals');
}
mkdirSync(out, { recursive: true });

let cgroupCpu = null;
try { cgroupCpu = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(); } catch {}
const machine = { cpu: os.cpus()[0]?.model, visibleCores: os.cpus().length, cgroupCpuMax: cgroupCpu, loadavg: os.loadavg(), node: process.version, platform: `${process.platform}/${process.arch}` };

let failed = 0;
for (const car of cars) {
  const r = spawnSync(process.execPath, ['--expose-gc', path.join(here, 'worker.mjs'), car, warm, runs], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(`${car}: worker failed\n${r.stderr}`); failed++; continue; }
  const res = JSON.parse(r.stdout.trim().split('\n').pop());
  res.event = 11; res.runs = +runs; res.warmups = +warm; res.measuredAt = new Date().toISOString(); res.machine = machine;
  res.resourceProfile = resourceProfile; res.runnerProcessAffinity = processAffinity;
  writeFileSync(path.join(out, `${car}.json`), JSON.stringify(res, null, 2) + '\n');
  console.log(`${car.padEnd(15)} ${res.version.padEnd(8)} correct=${res.correct}  geomean ${res.geomeanOpsPerSec ? (res.geomeanOpsPerSec / 1e6).toFixed(3) + ' Mops/s' : 'n/a'}`);
  if (!res.correct) failed++;
}
process.exit(failed ? 1 : 0);
