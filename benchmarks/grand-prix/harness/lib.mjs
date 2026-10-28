// Shared plumbing for the Grand Prix harness. Everything the race starts carries the labels
// grandprix=forma-264 and gp264run=<id>, and is removed on exit, on error and on signals.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSSRPage } from './ssr-contract.mjs';
import assert from 'node:assert/strict';
import { hostProfile, parseCpuList } from './resource-profile.mjs';
import { createCampaign, readCampaign } from './campaign.mjs';
import { requestHeaders, ohaArguments, captureResponse, validateResponse, assertSampleRepresentation, wireMeasurement } from './transport.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RESULTS = path.resolve(process.env.GP_RESULTS_DIR || path.join(ROOT, 'results'));
export const RAW = process.env.GP_RAW_DIR ? path.resolve(process.env.GP_RAW_DIR) : path.join(RESULTS, 'raw');
export const REQUEST_ENCODING = process.env.GP_ACCEPT_ENCODING;
if (REQUEST_ENCODING && !['identity', 'br', 'gzip'].includes(REQUEST_ENCODING)) throw new Error('invalid compression experiment encoding');
export const REQUEST_HEADERS = requestHeaders(REQUEST_ENCODING ?? 'identity');
export const LABEL = 'grandprix=forma-264';
export const IMAGE_PREFIX = process.env.GP_IMAGE_PREFIX || 'gp264';
if (!/^[a-z0-9/-]+$/.test(IMAGE_PREFIX)) throw new Error('invalid image prefix');
export const imageName = car => `${IMAGE_PREFIX}/${car}`;
export const RUN_ID = process.env.GP_RUN_ID || ('r' + Date.now().toString(36) + process.pid);
if (!/^[a-z0-9-]+$/.test(RUN_ID)) throw new Error('invalid GP_RUN_ID');
export const RUN_LABEL = 'gp264run=' + RUN_ID;

// Reporting imports this module offline; only runners initialize host resources.
export const cpusetArgs = cpuset => cpuset ? ['--cpuset-cpus=' + cpuset] : [];

// Protocol constants, overridable only for the end-to-end test (the report records what was used).
export const CFG = {
  duration: 10, warmup: 5, runs: 3, concurrency: 64, starts: 5, buildRuns: 3, requestHeaders: REQUEST_HEADERS,
  ...(REQUEST_ENCODING ? { acceptEncoding: REQUEST_ENCODING } : {}),
};

export let CAMPAIGN;
export function configureResources() {
  CAMPAIGN = process.env.GP_CAMPAIGN_FILE ? readCampaign() : createCampaign(path.join(RESULTS, `${RUN_ID}-campaign.json`));
  const profile = hostProfile();
  Object.assign(CFG, { resourceProfile: profile, classA: profile.classA, classB: profile.classB,
    loadgenCpus: profile.loadgen.cpus, loadgenCpuset: profile.loadgen.cpuset,
    buildCpus: profile.build.cpus, buildCpuset: profile.build.cpuset });
  return profile;
}

export const EVENTS = [
  { n: 1, id: 'sprint', title: 'SSR Sprint' }, { n: 2, id: 'endurance', title: 'SSR Endurance' },
  { n: 3, id: 'multicore', title: 'Multi-core' }, { n: 4, id: 'reaction', title: 'Reaction time' },
  { n: 5, id: 'fuel', title: 'Fuel' }, { n: 6, id: 'grid', title: 'Grid start' },
  { n: 7, id: 'weight', title: 'Weight' }, { n: 8, id: 'pitstop', title: 'Pit stop' },
  { n: 9, id: 'dom', title: 'DOM race' }, { n: 10, id: 'bundle', title: 'Bundle' },
  { n: 11, id: 'signals', title: 'Signals' },
];

export const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- process helpers ----------
export function sh(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => resolve({ code: -1, stdout: out, stderr: err + e.message }));
    p.on('close', code => resolve({ code, stdout: out, stderr: err }));
  });
}
export const docker = (...args) => sh('docker', args);
export function dockerSync(...args) {
  try { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

// ---------- cleanup: nothing may stay running ----------
let networks = new Set(), installed = false;
export function cleanupSync() {
  const ids = dockerSync('ps', '-aq', '--filter', 'label=' + RUN_LABEL).split('\n').filter(Boolean);
  if (ids.length) dockerSync('rm', '-f', ...ids);
  for (const n of networks) dockerSync('network', 'rm', n);
  networks.clear();
}
export function installTrap() {
  if (installed) return; installed = true;
  process.on('exit', cleanupSync);
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { log('signal', s, '-> cleaning up'); cleanupSync(); process.exit(130); });
  process.on('uncaughtException', e => { console.error(e); cleanupSync(); process.exit(1); });
  process.on('unhandledRejection', e => { console.error(e); cleanupSync(); process.exit(1); });
}
let seq = 0;
export const uniq = p => `gp264-${p}-${process.pid}-${++seq}`;

export async function makeNetwork() {
  const name = uniq('net');
  const r = await docker('network', 'create', '--label', LABEL, '--label', RUN_LABEL, name);
  if (r.code) throw new Error('network create: ' + r.stderr);
  networks.add(name); return name;
}
export async function removeNetwork(name) { await docker('network', 'rm', name); networks.delete(name); }

export function limitsFor(cls) { return cls === 'B' ? CFG.classB : CFG.classA; }

// Starts the car's image as the contract says. Published to a random loopback port for the
// harness's own probes (body check, gzip size, first-200 timing); load goes over the network.
export async function startCar(car, cls, network, extra = []) {
  const lim = limitsFor(cls), name = uniq(car);
  const r = await docker('run', '-d', '--name', name, '--label', LABEL, '--label', RUN_LABEL,
    '--network', network, '--cpus=' + lim.cpus, ...cpusetArgs(lim.cpuset), '--memory=' + lim.memory,
    '-e', 'GP_WORKERS=' + lim.workers, '-e', 'NODE_ENV=production', '-p', '127.0.0.1::3000', ...extra, imageName(car));
  if (r.code) throw new Error('docker run failed: ' + r.stderr.trim());
  return { name, car, cls, id: r.stdout.trim() };
}
export async function hostPort(c) {
  const r = await docker('port', c.name, '3000/tcp');
  const m = r.stdout.match(/127\.0\.0\.1:(\d+)/) || r.stdout.match(/:(\d+)/);
  if (!m) throw new Error('no published port: ' + r.stdout + r.stderr);
  return +m[1];
}
export async function removeContainer(c) { if (c) await docker('rm', '-f', c.name); }

export async function startLoadgen(network) {
  const name = uniq('loadgen');
  const r = await docker('run', '-d', '--name', name, '--label', LABEL, '--label', RUN_LABEL,
    '--network', network, '--cpus=' + CFG.loadgenCpus, ...cpusetArgs(CFG.loadgenCpuset), imageName('loadgen'));
  if (r.code) throw new Error('loadgen start failed (is gp264/loadgen built? harness/linux-run.mjs): ' + r.stderr.trim());
  return { name };
}

// Inspect after startup/timing so the boot metric keeps its original timer boundary.
export async function assertContainerResources(container, limits) {
  const result = await docker('container', 'inspect', container.name);
  assert.equal(result.code, 0, 'cannot verify container resource limits');
  const actual = JSON.parse(result.stdout)[0];
  assert.equal(actual.HostConfig.NanoCpus, Number(limits.cpus) * 1e9, 'CPU quota drift');
  assert.deepEqual(actual.HostConfig.CpusetCpus ? parseCpuList(actual.HostConfig.CpusetCpus) : [], limits.cpuset ? parseCpuList(limits.cpuset) : [], 'CPU affinity drift');
  if (limits.memory) assert.equal(actual.HostConfig.Memory, Number(limits.memory.replace('g', '')) * 1024 ** 3, 'memory quota drift');
  if (limits.workers) assert(actual.Config.Env.includes('GP_WORKERS=' + limits.workers), 'worker count drift');
  return { nanoCpus: actual.HostConfig.NanoCpus, cpuset: actual.HostConfig.CpusetCpus, memoryBytes: actual.HostConfig.Memory };
}

// ---------- HTTP probes from the host ----------
export function get(port, p, headers = {}, timeout = 5000) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: p, agent: false, headers: { ...REQUEST_HEADERS, ...headers }, timeout }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks) }));
      res.on('error', e => resolve({ status: 0, error: e.message }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.on('error', e => resolve({ status: 0, error: e.message }));
  });
}
export async function waitReady(c, port, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await get(port, '/health', {}, 1500);
    if (r.status === 200) return Date.now() - t0;
    const st = dockerSync('inspect', '-f', '{{.State.Running}}', c.name);
    if (st !== 'true') throw new Error('container exited before ready: ' + dockerSync('logs', '--tail', '5', c.name));
    await sleep(25);
  }
  throw new Error('not ready in ' + ms + ' ms');
}

// ---------- body verification ----------
export function checkBody(n, body) {
  try { const result = assertSSRPage(n, body.toString('utf8')); return { ok: true, rows: result.rowCount, problems: [] }; }
  catch (error) { return { ok: false, rows: null, problems: [error.message] }; }
}

// Retain the exact representation checked before timing, including small-page coverage.
export async function smokeCar(car) {
  const rec = { car, at: new Date().toISOString(), pass: false, checks: [], responses: {}, requestHeaders: REQUEST_HEADERS, image: imageInfo(car) };
  if (!rec.image.id) { rec.checks.push({ name: 'image', ok: false, detail: imageName(car) + ' not found' }); return rec; }
  const net = await makeNetwork(); let c;
  try {
    c = await startCar(car, 'A', net);
    const port = await hostPort(c);
    try { rec.readyMs = await waitReady(c, port); } catch (e) { rec.checks.push({ name: 'health', ok: false, detail: e.message }); return rec; }
    const h = await get(port, '/health');
    rec.checks.push({ name: 'health', ok: h.status === 200 && h.body.toString().trim() === 'ok', detail: `status ${h.status} body "${h.body?.toString().slice(0, 20)}"` });
    for (const n of [10, 100, 1000]) {
      const r = await get(port, '/ssr?rows=' + n, {}, 15000);
      const response = rec.responses[n] = captureResponse(n, r, REQUEST_HEADERS);
      try {
        validateResponse(response, REQUEST_HEADERS);
        rec.checks.push({ name: 'ssr' + n, ok: true, detail: `${n} rows, ${response.bytes} bytes`, bytes: response.bytes });
      } catch (error) { rec.checks.push({ name: 'ssr' + n, ok: false, detail: error.message }); }
    }
    rec.pass = rec.checks.every(x => x.ok);
  } catch (e) { rec.checks.push({ name: 'start', ok: false, detail: e.message }); }
  finally { await removeContainer(c); await removeNetwork(net); }
  return rec;
}

export function imageInfo(ref) {
  const out = dockerSync('image', 'inspect', '--format', '{{.Id}}|{{.Size}}|{{.Created}}|{{.Architecture}}', imageName(ref));
  if (!out) return {};
  const [id, size, created, arch] = out.split('|');
  return { id, sizeBytes: +size, created, arch };
}

// ---------- oha ----------
export async function oha(lg, url, { c, z, evidence, response }) {
  const args = ohaArguments(url, { c, z }, REQUEST_HEADERS);
  const r = await docker('exec', lg.name, ...args);
  // Save even malformed output and nonzero exits before any assertion. Warmups
  // and every timed sample have their own retained file, including on failure.
  const raw = { at: new Date().toISOString(), target: url, requested: { c, z }, arguments: args,
    requestHeaders: REQUEST_HEADERS, response, exitCode: r.code, stderr: r.stderr };
  try { raw.rawOha = JSON.parse(r.stdout); } catch { raw.stdout = r.stdout; }
  writeRaw('transport', evidence, raw);
  assert.equal(r.code, 0, 'oha failed: ' + r.stderr.slice(0, 300));
  const j = raw.rawOha;
  assert(j?.summary, 'invalid oha output');
  const codes = j.statusCodeDistribution || {};
  const total = Object.values(codes).reduce((a, b) => a + b, 0);
  const ok = codes['200'] || 0;
  const result = {
    ...raw, seconds: j.summary.total, rps: j.summary.requestsPerSec, okRps: ok / j.summary.total, requests: total, ok, nonOk: total - ok,
    successRate: j.summary.successRate, statusCodes: codes, errorDistribution: j.errorDistribution,
    latencyMs: { mean: j.summary.average * 1000, p50: j.latencyPercentiles.p50 * 1000, p95: j.latencyPercentiles.p95 * 1000, p99: j.latencyPercentiles.p99 * 1000, max: j.summary.slowest * 1000 },
    bytesPerRequest: j.summary.sizePerRequest, totalData: j.summary.totalData,
  };
  result.wireBytes = wireMeasurement(result, response);
  writeRaw('transport', evidence, result);
  assertSampleRepresentation(result, response, REQUEST_HEADERS);
  return result;
}

// ---------- docker stats sampler ----------
export function parseMem(s) {
  const m = String(s).split('/')[0].trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
  if (!m) return null;
  const f = { b: 1, kib: 1024, mib: 1048576, gib: 1073741824, kb: 1e3, mb: 1e6, gb: 1e9 }[m[2].toLowerCase()];
  return f ? +m[1] * f / 1048576 : null; // MiB
}
export function startSampler(name) {
  const samples = []; let stop = false;
  const done = (async () => {
    while (!stop) {
      const t = Date.now(), r = await docker('stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', name);
      const [m, cpu] = r.stdout.trim().split('|'); const mib = parseMem(m);
      if (mib != null) samples.push({ t, mib: +mib.toFixed(2), cpu });
    }
  })();
  return { samples, async stop() { stop = true; await done; return samples; } };
}

// ---------- machine state ----------
export function machineState(extra = {}) {
  const info = dockerSync('info', '--format', '{{.NCPU}}|{{.MemTotal}}|{{.ServerVersion}}|{{.KernelVersion}}|{{.OperatingSystem}}').split('|');
  const ps = (() => { try { return execFileSync('ps', process.platform === 'linux' ? ['-Ao', 'pcpu,comm', '--sort=-pcpu'] : ['-Ao', 'pcpu,comm', '-r'], { encoding: 'utf8' }).split('\n').slice(1, 6).map(s => s.trim()); } catch { return []; } })();
  return {
    at: new Date().toISOString(), hostLoadAvg: os.loadavg().map(x => +x.toFixed(2)), hostCpuModel: os.cpus()[0]?.model, hostCpus: os.cpus().length,
    hostMemGB: +(os.totalmem() / 1e9).toFixed(1), hostFreeDisk: freeDisk(),
    availableCpus: os.availableParallelism(), kernel: os.release(),
    cpuPressure: fs.existsSync('/proc/pressure/cpu') ? fs.readFileSync('/proc/pressure/cpu', 'utf8') : null,
    dockerCpus: +info[0], dockerMemGB: +(info[1] / 1e9).toFixed(2), dockerVersion: info[2], dockerKernel: info[3], dockerOs: info[4],
    node: process.version, oha: 'oha 1.16.0 (gp264/loadgen)', topProcesses: ps, quiet: os.loadavg()[0] < 2, ...extra,
  };
}
export function freeDisk() { try { return execFileSync('df', ['-h', os.homedir()], { encoding: 'utf8' }).split('\n')[1].split(/\s+/)[3]; } catch { return ''; } }

// ---------- output ----------
export function writeRaw(event, car, obj) {
  const dir = path.join(RAW, event); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, car + '.json'), JSON.stringify({ event, car, ...obj, campaign: CAMPAIGN }, null, 2));
}
export function readRaw(event, car) { try { return JSON.parse(fs.readFileSync(path.join(RAW, event, car + '.json'), 'utf8')); } catch { return null; } }

export function stats(v) {
  const n = v.length, mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd, min: Math.min(...v), max: Math.max(...v) };
}
