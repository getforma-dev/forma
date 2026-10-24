#!/usr/bin/env node
// The race director's runner. Usage:
//   node harness/race.mjs [--cars a,b,c] [--events 1-8 | 1,2,5 | sprint,fuel | dom,bundle,signals | all]
//        [--duration 10] [--warmup 5] [--runs 3] [--starts 5] [--build-runs 3] [--force] [--skip-smoke]
// Default cars: every contestants/<car>/ with an image gp264/<car>. Default events: 1-8.
// Events 9-11 call client-race/run.mjs, client-race/bundle.mjs and signals-race/run.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import {
  ROOT, RAW, REQUEST_ENCODING, REQUEST_HEADERS, CFG, CAMPAIGN, EVENTS, LABEL, RUN_LABEL, RUN_ID, log, sleep, docker, dockerSync, installTrap, makeNetwork, removeNetwork,
  startCar, hostPort, removeContainer, startLoadgen, waitReady, get, checkBody, smokeCar, imageInfo, oha,
  startSampler, parseMem, machineState, writeRaw, stats, uniq, imageName, cpusetArgs, assertContainerResources, configureResources,
} from './lib.mjs';
import { captureResponse, validateResponse } from './transport.mjs';
import { decodeExperimentResponse } from './compression-response.mjs';

configureResources();
installTrap();

// ---------- arguments ----------
const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  opt[k] = v;
}
if (opt.duration) CFG.duration = +opt.duration;
if (opt.warmup) CFG.warmup = +opt.warmup;
if (opt.runs) CFG.runs = +opt.runs;
if (opt.starts) CFG.starts = +opt.starts;
if (opt['build-runs']) CFG.buildRuns = +opt['build-runs'];

function parseEvents(s) {
  if (!s || s === true) s = '1-8';
  if (s === 'all') s = '1-11';
  const out = new Set();
  for (const part of String(s).split(',')) {
    const r = part.match(/^(\d+)-(\d+)$/);
    if (r) { for (let n = +r[1]; n <= +r[2]; n++) out.add(n); continue; }
    const e = EVENTS.find(e => String(e.n) === part || e.id === part);
    if (!e) { console.error('unknown event ' + part); process.exit(2); }
    out.add(e.n);
  }
  return [...out].sort((a, b) => a - b);
}
const events = parseEvents(opt.events);

function discoverCars() {
  const dir = path.join(ROOT, 'contestants');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory()) : [];
  return names.filter(c => imageInfo(c).id);
}
const cars = opt.cars ? String(opt.cars).split(',') : discoverCars();
if (REQUEST_ENCODING && (cars.length !== 1 || cars[0] !== 'forma')) throw new Error('compression experiment is Forma-only');
const serverEvents = events.filter(n => n <= 8);
if (serverEvents.length && !cars.length) { console.error('no cars: pass --cars or build gp264/<car> images'); process.exit(2); }

// ---------- the quiet-machine rule ----------
const load1 = os.loadavg()[0];
if (load1 > 4 && !opt.force) {
  console.error(`host load average is ${load1.toFixed(1)}: not a quiet machine. Pause background apps, or pass --force (it is recorded).`);
  process.exit(3);
}
const forced = load1 > 4;
const sleepBetween = opt.settle ? +opt.settle : 5000;

// ---------- stack helper ----------
async function withStack(car, cls, { loadgen = true, rows = 100, event } = {}, fn) {
  const net = await makeNetwork(); let c, lg;
  try {
    c = await startCar(car, cls, net);
    const port = await hostPort(c);
    await waitReady(c, port);
    const r = await get(port, '/ssr?rows=' + rows, {}, 20000);
    const response = captureResponse(rows, r, REQUEST_HEADERS);
    writeRaw('transport', `${car}-${event}-preflight`, { requestHeaders: REQUEST_HEADERS, response });
    validateResponse(response, REQUEST_HEADERS);
    const smoke = smokeResults[car]?.responses?.[rows];
    if (REQUEST_HEADERS['accept-encoding'] === 'identity' && smoke && smoke.bytes !== response.bytes) throw new Error('smoke/event response sizes differ');
    const body = REQUEST_ENCODING ? decodeExperimentResponse(r, REQUEST_ENCODING) : r.body;
    const chk = r.status === 200 ? checkBody(rows, body) : { ok: false, problems: ['status ' + r.status] };
    if (!chk.ok) throw new Error('body check failed before timing: ' + chk.problems.join('; '));
    const resources = { server: await assertContainerResources(c, limits(cls)), loadgen: null };
    if (loadgen) {
      lg = await startLoadgen(net);
      resources.loadgen = await assertContainerResources(lg, { cpus: CFG.loadgenCpus, cpuset: CFG.loadgenCpuset });
    }
    const records = await fn({ c, port, lg, net, response, url: `http://${c.name}:3000` });
    for (const record of Object.values(records)) { record.resources = resources; record.response = response; }
    return records;
  } finally { await removeContainer(lg); await removeContainer(c); await removeNetwork(net); }
}
const meta = (car, extra) => ({ at: new Date().toISOString(), runId: RUN_ID, campaign: CAMPAIGN, config: { ...CFG, forced }, image: imageInfo(car), ...extra });

// ---------- events ----------
async function throughput(car, evId, cls, rows, alsoFuel) {
  const before = machineState();
  return withStack(car, cls, { rows, event: evId }, async ({ c, lg, url, response }) => {
    const target = `${url}/ssr?rows=${rows}`;
    const idle = (await docker('stats', '--no-stream', '--format', '{{.MemUsage}}', c.name)).stdout.trim();
    log(`  ${evId} warm-up ${CFG.warmup}s`);
    const sw = alsoFuel ? startSampler(c.name) : null;
    let warmup, warmSamples = [];
    try { warmup = await oha(lg, target, { c: CFG.concurrency, z: CFG.warmup, response, evidence: `${car}-${evId}-warmup` }); }
    finally { if (sw) warmSamples = await sw.stop(); }
    const runs = [], peaks = [], allSamples = [];
    for (let i = 1; i <= CFG.runs; i++) {
      const s = alsoFuel ? startSampler(c.name) : null;
      let r, smp = [];
      try { r = await oha(lg, target, { c: CFG.concurrency, z: CFG.duration, response, evidence: `${car}-${evId}-${i}` }); }
      finally { if (s) await s.stop(); }
      if (s) {
        smp = s.samples;
        const fin = parseMem((await docker('stats', '--no-stream', '--format', '{{.MemUsage}}', c.name)).stdout.trim()); // residency right after the load
        if (fin != null) smp.push({ t: Date.now(), mib: +fin.toFixed(2), cpu: 'post' });
        allSamples.push(...smp);
      }
      r.run = i; runs.push(r);
      if (s) { const peak = smp.length ? Math.max(...smp.map(x => x.mib)) : null; peaks.push(peak); r.peakMiB = peak; r.memSamples = smp.length; }
      log(`  ${evId} run ${i}: ${r.okRps.toFixed(0)} req/s ok, p99 ${r.latencyMs.p99.toFixed(2)} ms, non-200 ${r.nonOk}`);
    }
    const out = {
      class: cls, rows, concurrency: CFG.concurrency, durationS: CFG.duration, warmupS: CFG.warmup,
      metric: { name: 'requests per second', unit: 'req/s', better: 'higher' }, values: runs.map(r => r.okRps), runs, warmup,
      bytesPerRequest: runs[0].bytesPerRequest, container: { ...limits(cls) },
    };
    const result = { [evId]: meta(car, { machine: { before, after: machineState() }, ...out }) };
    if (alsoFuel) {
      const valid = peaks.filter(x => x != null);
      result.fuel = meta(car, {
        class: cls, rows, machine: { before, after: machineState() }, source: 'docker stats --no-stream sampled back to back during the Sprint warm-up and its runs',
        metric: { name: 'peak resident memory under Sprint load', unit: 'MiB', better: 'lower' },
        values: valid, idleAtStart: idle, warmupPeakMiB: warmSamples.length ? Math.max(...warmSamples.map(x => x.mib)) : null,
        runs: runs.map(r => ({ run: r.run, peakMiB: r.peakMiB, samples: r.memSamples })),
        samples: allSamples.map(s => ({ t: s.t, mib: s.mib, cpu: s.cpu })),
      });
    }
    return result;
  });
}
const limits = cls => (cls === 'B' ? CFG.classB : CFG.classA);

async function reaction(car) {
  const before = machineState();
  return withStack(car, 'A', { event: 'reaction' }, async ({ lg, url, response }) => {
    const target = `${url}/ssr?rows=100`;
    log(`  reaction warm-up ${CFG.warmup}s`);
    const warmup = await oha(lg, target, { c: 1, z: CFG.warmup, response, evidence: `${car}-reaction-warmup` });
    const runs = [];
    for (let i = 1; i <= CFG.runs; i++) {
      const r = await oha(lg, target, { c: 1, z: CFG.duration, response, evidence: `${car}-reaction-${i}` }); r.run = i; runs.push(r);
      log(`  reaction run ${i}: p99 ${r.latencyMs.p99.toFixed(3)} ms (p50 ${r.latencyMs.p50.toFixed(3)}), ${r.requests} reqs`);
    }
    return { reaction: meta(car, { class: 'A', rows: 100, concurrency: 1, durationS: CFG.duration, warmupS: CFG.warmup, container: { ...limits('A') }, machine: { before, after: machineState() },
      metric: { name: 'p99 latency at concurrency 1', unit: 'ms', better: 'lower' }, values: runs.map(r => r.latencyMs.p99), runs, warmup }) };
  });
}

async function gridStart(car) {
  const before = machineState(), starts = [];
  const net = await makeNetwork();
  try {
    for (let i = 1; i <= CFG.starts; i++) {
      const t0 = performance.now(); let c, tRun, ms, resources, status = 0;
      try {
        c = await startCar(car, 'A', net); tRun = performance.now() - t0;
        const port = await hostPort(c);
        for (;;) {
          const r = await get(port, '/ssr?rows=100', {}, 2000);
          if (r.status === 200) { ms = performance.now() - t0; status = 200; break; }
          if (performance.now() - t0 > 60000) throw new Error('no 200 within 60 s');
          const up = dockerSync('inspect', '-f', '{{.State.Running}}', c.name);
          if (up !== 'true') throw new Error('container exited: ' + dockerSync('logs', '--tail', '5', c.name));
          await sleep(2);
        }
        resources = await assertContainerResources(c, limits('A'));
      } finally { await removeContainer(c); }
      starts.push({ start: i, ms, dockerRunReturnedMs: tRun, resources });
      log(`  grid start ${i}: ${ms.toFixed(0)} ms`);
      await sleep(1000);
    }
  } finally { await removeNetwork(net); }
  return { grid: meta(car, { class: 'A', machine: { before, after: machineState() },
    method: 'timer starts before `docker run -d`, stops at the first 200 on /ssr?rows=100 polled from the host through the published port every ~2 ms',
    metric: { name: 'container start to first 200', unit: 'ms', better: 'lower' }, values: starts.map(s => s.ms), runs: starts }) };
}

async function weight(car) {
  const before = machineState(), img = imageInfo(car);
  return withStack(car, 'A', { loadgen: false, event: 'weight' }, async ({ port }) => {
    const plain = await get(port, '/ssr?rows=100', { 'accept-encoding': 'identity' }, 15000);
    const enc = await get(port, '/ssr?rows=100', { 'accept-encoding': REQUEST_ENCODING ?? 'gzip' }, 15000);
    let representation;
    if (REQUEST_ENCODING) {
      const decoded = decodeExperimentResponse(enc, REQUEST_ENCODING);
      if (!decoded.equals(plain.body)) throw new Error('encoded response differs from the identity page');
      representation = { requestedEncoding: REQUEST_ENCODING, contentEncoding: enc.headers['content-encoding'] ?? 'identity',
        encodedBytes: enc.body.length, decodedBytes: decoded.length, verified: true };
    }
    const gz = zlib.gzipSync(plain.body, { level: 9 });
    return { weight: meta(car, { class: 'A', machine: { before, after: machineState() },
      parts: {
        image: { metric: { name: 'runtime image size', unit: 'bytes', better: 'lower' }, values: [img.sizeBytes], source: 'docker image inspect ' + imageName(car) },
        gzip: { metric: { name: 'gzip response bytes, 100 rows', unit: 'bytes', better: 'lower' }, values: [gz.length], rawBytes: plain.body.length,
          source: 'response body gzip level 9 by the harness', contentEncodingWhenAsked: enc.headers?.['content-encoding'] || null, bytesWhenServerCompresses: enc.headers?.['content-encoding'] ? enc.body.length : null },
      },
      ...(representation ? { representation } : {}),
      extraHeaders: { contentType: plain.headers['content-type'], contentLength: plain.headers['content-length'] || null } }) };
  });
}

async function runBuild(car, script) {
  const name = uniq(car + '-build'), t0 = performance.now();
  const r = await docker('run', '--rm', '--name', name, '--label', LABEL, '--label', RUN_LABEL, '--cpus=' + CFG.buildCpus, ...cpusetArgs(CFG.buildCpuset), imageName(car + '-build'), script);
  const wall = performance.now() - t0, m = r.stdout.match(script.includes('rust') ? /GP_RUST_BUILD_MS=(\d+(?:\.\d+)?)/g : /GP_BUILD_MS=(\d+(?:\.\d+)?)/g);
  if (r.code || !m) throw new Error(`${script} failed (exit ${r.code}): ` + (r.stderr + r.stdout).slice(-400));
  return { buildMs: +m[m.length - 1].split('=')[1], wallMs: wall };
}
// Forma's scored build (PROTOCOL.md Amendment 3): the FMIR build, then a release compile of the app's own
// crate with its dependencies already compiled in the image (the counterpart of an installed node_modules).
async function runFormaBuild() {
  const name = uniq('forma-build'), t0 = performance.now();
  const sh = '/gp/build.sh && cd /app && touch src/*.rs && s=$(date +%s%N) && cargo build --release --locked --offline && e=$(date +%s%N) && echo GP_APP_BUILD_MS=$(( (e - s) / 1000000 ))';
  const r = await docker('run', '--rm', '--name', name, '--label', LABEL, '--label', RUN_LABEL, '--cpus=' + CFG.buildCpus, ...cpusetArgs(CFG.buildCpuset), imageName('forma-build'), 'sh', '-c', sh);
  const f = r.stdout.match(/GP_BUILD_MS=(\d+)/), a = r.stdout.match(/GP_APP_BUILD_MS=(\d+)/);
  if (r.code || !f || !a) throw new Error(`forma build failed (exit ${r.code}): ` + (r.stderr + r.stdout).slice(-400));
  return { buildMs: +f[1] + +a[1], fmirMs: +f[1], appCompileMs: +a[1], wallMs: performance.now() - t0 };
}
async function pitstop(car) {
  const before = machineState();
  if (!imageInfo(car + '-build').id) throw new Error(`gp264/${car}-build not found`);
  const runs = [];
  for (let i = 1; i <= CFG.buildRuns; i++) { const r = car === 'forma' ? await runFormaBuild() : await runBuild(car, '/gp/build.sh'); r.run = i; runs.push(r); log(`  pit stop run ${i}: ${(r.buildMs / 1000).toFixed(1)} s`); }
  const out = { class: 'build', cpus: CFG.buildCpus, cpuset: CFG.buildCpuset, machine: { before, after: null }, metric: { name: car === 'forma' ? 'production build time: FMIR build plus app crate release compile, dependencies compiled (Amendment 3)' : 'production build time (GP_BUILD_MS)', unit: 'ms', better: 'lower' }, values: runs.map(r => r.buildMs), runs };
  if (car === 'forma') {
    const has = (await docker('run', '--rm', '--label', LABEL, '--label', RUN_LABEL, imageName(car + '-build'), 'sh', '-c', 'test -x /gp/build-rust.sh')).code === 0;
    if (has) { const r = await runBuild(car, '/gp/build-rust.sh'); out.rust = { note: 'Cold Rust compile from an empty target, every dependency included, one run, reported beside, not scored', ...r }; log(`  forma rust compile: ${(r.buildMs / 1000).toFixed(1)} s`); }
    else out.rust = { note: '/gp/build-rust.sh not found in gp264/forma-build' };
  }
  out.machine.after = machineState();
  return { pitstop: meta(car, out) };
}

// ---------- external runners (events 9 to 11) ----------
async function external(evId, script, extraArgs = []) {
  const file = path.join(ROOT, script);
  if (!fs.existsSync(file)) { log(`  ${script} does not exist yet, skipped`); return { ok: false, why: 'missing ' + script }; }
  fs.mkdirSync(path.join(ROOT, 'harness', 'logs'), { recursive: true });
  const logf = path.join(ROOT, 'harness', 'logs', `${evId}-${Date.now()}.log`), out = fs.openSync(logf, 'w');
  const before = machineState();
  const signals = evId === 'signals';
  const program = signals ? 'docker' : process.execPath;
  const args = signals ? ['run', '--rm', '--label', LABEL, '--label', RUN_LABEL, '--cpus=1', '--memory=1g', '-e', `GP_CAMPAIGN_JSON=${JSON.stringify(CAMPAIGN)}`,
    '-v', `${path.join(ROOT, 'harness/campaign.mjs')}:/gp/harness/campaign.mjs:ro`,
    '-v', `${path.join(ROOT, 'results/raw/signals')}:/out`, imageName('signals'), ...extraArgs] : [file, ...extraArgs];
  fs.mkdirSync(path.join(ROOT, 'results/raw', evId), { recursive: true });
  const code = await new Promise(res => {
    const p = spawn(program, args, { cwd: ROOT, stdio: ['ignore', out, out] });
    p.on('error', () => res(-1)); p.on('close', res);
  });
  const dir = path.join(ROOT, 'results', 'raw', evId); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_machine.json'), JSON.stringify({ event: evId, campaign: CAMPAIGN, runner: script, exitCode: code, log: path.relative(ROOT, logf), before, after: machineState(), config: { forced } }, null, 2));
  log(`  ${script} exit ${code}, log ${path.relative(ROOT, logf)}`);
  return { ok: code === 0 };
}

// ---------- main ----------
const smokeResults = {}, failures = [];
async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  log(`race ${RUN_ID}: cars [${cars.join(', ')}], events [${events.join(', ')}], config ${JSON.stringify({ d: CFG.duration, w: CFG.warmup, runs: CFG.runs, starts: CFG.starts, buildRuns: CFG.buildRuns })}${forced ? ' FORCED on a loaded machine' : ''}`);
  if (serverEvents.length) {
    for (const car of cars) {
      log(`== ${car}`);
      if (!opt['skip-smoke']) {
        const s = await smokeCar(car); smokeResults[car] = s; writeRaw('smoke', car, s);
        if (!s.pass) { log(`  SMOKE FAIL, ${car} is out of every event: ` + s.checks.filter(x => !x.ok).map(x => x.name + ': ' + x.detail).join(' | ')); failures.push({ car, event: 'smoke' }); continue; }
        log(`  smoke pass (ready in ${s.readyMs} ms)`);
      }
      const jobs = [];
      if (events.includes(1) || events.includes(5)) jobs.push(['1+5', async () => {
        const r = await throughput(car, 'sprint', 'A', 100, true);
        if (events.includes(1)) writeRaw('sprint', car, r.sprint);
        if (events.includes(5)) writeRaw('fuel', car, r.fuel);
      }]);
      if (events.includes(2)) jobs.push([2, async () => writeRaw('endurance', car, (await throughput(car, 'endurance', 'A', 1000, false)).endurance)]);
      if (events.includes(4)) jobs.push([4, async () => writeRaw('reaction', car, (await reaction(car)).reaction)]);
      if (events.includes(3)) jobs.push([3, async () => writeRaw('multicore', car, (await throughput(car, 'multicore', 'B', 100, false)).multicore)]);
      if (events.includes(6)) jobs.push([6, async () => writeRaw('grid', car, (await gridStart(car)).grid)]);
      if (events.includes(7)) jobs.push([7, async () => writeRaw('weight', car, (await weight(car)).weight)]);
      if (events.includes(8)) jobs.push([8, async () => writeRaw('pitstop', car, (await pitstop(car)).pitstop)]);
      for (const [n, job] of jobs) {
        log(` event ${n}`);
        try { await job(); } catch (e) { log(`  event ${n} FAILED for ${car}: ${e.message}`); failures.push({ car, event: n, error: e.message }); }
        await sleep(sleepBetween);
      }
    }
  }
  const ext = { 9: ['dom', 'client-race/run.mjs'], 10: ['bundle', 'client-race/bundle.mjs'], 11: ['signals', 'signals-race/run.mjs'] };
  for (const n of events.filter(n => n > 8)) {
    log(`== event ${n} ${ext[n][0]}`);
    const r = await external(ext[n][0], ext[n][1]);
    if (!r.ok) failures.push({ event: n, error: r.why || 'runner exited non-zero' });
  }
  fs.writeFileSync(path.join(RAW, '_run-' + RUN_ID + '.json'), JSON.stringify({ runId: RUN_ID, campaign: CAMPAIGN, cars, events, config: CFG, forced, failures, finished: new Date().toISOString() }, null, 2));
  const left = dockerSync('ps', '-aq', '--filter', 'label=' + RUN_LABEL);
  log(failures.length ? `done with ${failures.length} failure(s): ${JSON.stringify(failures)}` : 'done, no failures');
  if (left) log('WARNING containers still present, cleaning: ' + left);
}
try { await main(); } catch (e) { console.error(e); failures.push({ error: String(e) }); process.exitCode = 1; }
process.exit(process.exitCode || (failures.length ? 1 : 0));
