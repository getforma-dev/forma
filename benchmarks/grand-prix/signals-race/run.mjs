// Event 11. Usage: node run.mjs [--cars forma,solid] [--runs 5] [--warmups 2] [--out ../results/raw/signals]
// In Docker (image gp264/signals) the default output is /out: mount the host's results/raw/signals there.
// Each car runs in a fresh child process, one after another.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARS } from './cars.mjs';
import { count, validateCars } from './validation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const out = arg('out', process.env.GP_OUT || (existsSync('/.dockerenv') ? '/out' : path.join(process.env.GP_RESULTS_DIR || path.join(here, '..', 'results'), 'raw', 'signals')));
const cars = validateCars(arg('cars', CARS.join(',')).split(','));
const runs = count(arg('runs', '5'), 'runs', 1), warm = count(arg('warmups', '2'), 'warmups');
const timeout = count(arg('timeout', '600000'), 'timeout', 1, 3600000);
let resourceProfile = null, processAffinity = null, campaign = null;
if (process.env.GP_CAMPAIGN_JSON) {
  const { validateCampaign } = await import('../harness/campaign.mjs');
  campaign = validateCampaign(JSON.parse(process.env.GP_CAMPAIGN_JSON));
}
if (process.env.GP_RESOURCE_PROFILE) {
  const { validateProfile, verifyRoleAffinity } = await import('../harness/resource-profile.mjs');
  resourceProfile = validateProfile(JSON.parse(process.env.GP_RESOURCE_PROFILE));
  processAffinity = verifyRoleAffinity(resourceProfile, 'signals');
}
if (resourceProfile?.qualified && (runs !== 5 || warm !== 2)) throw new Error('qualified signals race requires five runs and two warmups');
if (resourceProfile?.qualified && !campaign) throw new Error('qualified run requires a campaign identity');
mkdirSync(out, { recursive: true });
for (const car of cars) if (existsSync(path.join(out, `${car}.json`))) throw new Error('Refusing to overwrite retained result: ' + car);

let cgroupCpu = null;
try { cgroupCpu = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(); } catch {}
const machine = { cpu: os.cpus()[0]?.model, visibleCores: os.cpus().length, cgroupCpuMax: cgroupCpu, loadavg: os.loadavg(), node: process.version, platform: `${process.platform}/${process.arch}` };

let failed = 0;
for (const car of cars) {
  const destination = path.join(out, `${car}.json`);
  if (existsSync(destination)) throw new Error(`Refusing to overwrite retained result: ${destination}`);
  const res = { car, event: 11, runs, warmups: warm, measuredAt: new Date().toISOString(), machine,
    campaign, resourceProfile, runnerProcessAffinity: processAffinity, executionOrder: cars, workerTimeoutMs: timeout, correct: false, status: 'failed',
    gcPolicy: 'explicit collection before each workload; same policy for every adapter' };
  try {
    const r = spawnSync(process.execPath, ['--expose-gc', path.join(here, 'worker.mjs'), car, String(warm), String(runs)], { encoding: 'utf8', maxBuffer: 1 << 26, timeout, killSignal: 'SIGKILL' });
    if (r.error || r.status !== 0) throw new Error(r.error?.message || `worker exit ${r.status} (${r.signal || 'no signal'}): ${r.stderr.slice(-4000)}`);
    Object.assign(res, JSON.parse(r.stdout.trim().split('\n').pop()));
    if (!res.correct) throw new Error('Adapter failed correctness checks');
    res.status = 'passed';
    console.log(`${car.padEnd(18)} ${res.version.padEnd(8)} correctness passed; ${Object.keys(res.benches).length} workloads recorded`);
  } catch (error) { res.error = error.message; failed++; console.error(`${car}: FAILED: ${error.message}`); }
  writeFileSync(destination, JSON.stringify(res, null, 2) + '\n', { flag: 'wx' });
}
process.exitCode = failed ? 1 : 0;
