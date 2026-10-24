import { createCampaign } from './campaign.mjs';
// Separate diagnostic binary. Never replace the executable in a raced image.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { instrumentRenderCounts } from './render-counts-source.mjs';
import { hostProfile, validateEngineProfile, parseCpuList } from './resource-profile.mjs';

const argv = process.argv.slice(2);
const option = key => argv.includes(`--${key}`) ? argv[argv.indexOf(`--${key}`) + 1] : undefined;
const runtime = option('runtime-image'), build = option('build-image'), commit = option('source-commit');
for (const id of [runtime, build]) assert(/^sha256:[a-f0-9]{64}$/.test(id ?? ''), 'full immutable runtime and build image IDs required');
assert(/^[a-f0-9]{40}$/.test(commit ?? ''), 'exact source commit required');
const runId = process.env.GP_RUN_ID;
assert(/^[a-z0-9-]+$/.test(runId ?? ''), 'GP_RUN_ID required');
const diagnostic = argv.includes('--diagnostic');
const resourceProfile = hostProfile({ diagnostic });
const cpusetArgs = resourceProfile.classA.cpuset ? ['--cpuset-cpus=' + resourceProfile.classA.cpuset] : [];
assert(option('out'), 'fresh output directory required');
const out = resolve(option('out'));
assert(!out.includes(','), 'output path must be usable in a Docker bind mount');
assert(!existsSync(out), 'RenderCounts evidence already exists'); mkdirSync(out, { recursive: true });
const docker = args => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2 }).trim();
const inspect = (kind, id) => JSON.parse(docker([kind, 'inspect', id]))[0];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const labels = ['--label', 'grandprix=forma-264', '--label', `gp264run=${runId}`];
const containers = new Set();
const campaign = createCampaign(join(out, 'campaign.json'));
const machine = () => ({ at: new Date().toISOString(), host: `${process.platform}/${process.arch}`, kernel: os.release(),
  cpu: os.cpus()[0]?.model, cpus: os.availableParallelism(), load: os.loadavg() });
const report = { schema: 1, kind: 'instrumented-render-counts', campaign, instrumentation: true, diagnostic, resourceProfile, sourceCommit: commit,
  runtimeImage: runtime, buildImage: build, before: machine(), samples: [], passed: false,
  protocol: { warmups: 20, samples: 101, rows: [100, 1000], concurrency: 1, cpus: 1, cpuset: resourceProfile.classA.cpuset, memoryBytes: 1024 ** 3 },
  meaning: 'PageResponse.counts().walk_time excludes props conversion, document assembly, header instrumentation and HTTP transfer. This is not a throughput race.' };
const save = () => writeFileSync(join(out, 'render-counts.json'), JSON.stringify(report, null, 2) + '\n');
save();
let child, stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(signal); });
const run = args => new Promise((ok, fail) => {
  assert(!stopping, 'run interrupted');
  child = spawn('docker', args, { stdio: 'inherit' });
  child.once('error', fail);
  child.once('close', code => { child = undefined; code === 0 ? ok() : fail(Error(`docker exited ${code}`)); });
});
function create(image, extra = [], command = []) {
  assert(!stopping, 'run interrupted');
  const id = docker(['create', ...labels, ...extra, image, ...command]); containers.add(id); return id;
}
function remove(id) { docker(['rm', '-f', id]); containers.delete(id); }
async function start(id) {
  docker(['start', id]);
  const container = inspect('container', id);
  assert.equal(container.HostConfig.NanoCpus, 1_000_000_000);
  assert.equal(container.HostConfig.Memory, 1024 ** 3);
  assert.deepEqual(container.HostConfig.CpusetCpus ? parseCpuList(container.HostConfig.CpusetCpus) : [], resourceProfile.classA.cpuset ? parseCpuList(resourceProfile.classA.cpuset) : []);
  const url = `http://127.0.0.1:${container.NetworkSettings.Ports['3000/tcp'][0].HostPort}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200 && await response.text() === 'ok') return url;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('instrumented server did not become healthy');
}
async function page(url, rows) {
  assert(!stopping, 'run interrupted');
  const response = await fetch(`${url}/ssr?rows=${rows}`, { headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-encoding'), null);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal((/<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(body.toString())?.[1].match(/<tr(?:\s|>)/g) ?? []).length, rows);
  return { response, body };
}
function counts(headers, rows) {
  const result = Object.fromEntries(['ns', 'bytes', 'nodes', 'rows'].map(field => {
    const raw = headers.get(`x-gp-walk-${field}`);
    assert(raw && /^\d+$/.test(raw), 'missing instrumented count');
    const value = Number(raw); assert(Number.isSafeInteger(value) && value > 0); return [field, value];
  }));
  assert.equal(result.rows, rows); return result;
}
function stats(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], p99: sorted[Math.ceil(sorted.length * 0.99) - 1], min: sorted[0], max: sorted.at(-1) };
}
try {
  const engine = JSON.parse(docker(['info', '--format', '{{json .}}']));
  if (!diagnostic || resourceProfile.name === 'gha-4-v1') validateEngineProfile(resourceProfile, engine);
  report.dockerEngine = engine; save();
  for (const [name, id] of [['runtime', runtime], ['build', build]]) {
    const image = inspect('image', id);
    assert.equal(image.Id, id); assert.equal(image.Os, 'linux');
    assert.equal(image.Config.Labels?.grandprix, 'forma-264');
    writeFileSync(join(out, `${name}-image.json`), JSON.stringify(image, null, 2) + '\n');
  }
  const original = create(runtime, ['--cpus=1', ...cpusetArgs, '--memory=1g', '-p', '127.0.0.1::3000']);
  const compiler = create(build, ['--cpus=1', ...cpusetArgs, '--memory=2g', '-e', 'CARGO_BUILD_JOBS=1'],
    ['sh', '-c', 'cd /app && touch src/main.rs && cargo build --release --locked --offline']);
  docker(['cp', `${original}:/usr/local/bin/grandprix`, join(out, 'original-binary')]);
  docker(['cp', `${compiler}:/app/target/release/grandprix-forma`, join(out, 'build-binary')]);
  report.originalBinarySha256 = sha(readFileSync(join(out, 'original-binary')));
  assert.equal(sha(readFileSync(join(out, 'build-binary'))), report.originalBinarySha256, 'build image is not the source of the runtime binary');
  docker(['cp', `${compiler}:/app/src/main.rs`, join(out, 'source.original.rs')]);
  docker(['cp', `${compiler}:/app/Cargo.lock`, join(out, 'Cargo.lock')]);
  const source = readFileSync(join(out, 'source.original.rs'), 'utf8');
  const instrumented = instrumentRenderCounts(source);
  writeFileSync(join(out, 'source.instrumented.rs'), instrumented);
  report.source = { originalSha256: sha(source), instrumentedSha256: sha(instrumented) };
  try { execFileSync('git', ['diff', '--no-index', '--', 'source.original.rs', 'source.instrumented.rs'], { cwd: out }); }
  catch (error) { assert.equal(error.status, 1); writeFileSync(join(out, 'instrumentation.patch'), error.stdout); }
  docker(['cp', join(out, 'source.instrumented.rs'), `${compiler}:/app/src/main.rs`]);
  await run(['start', '-a', compiler]);
  assert.equal(inspect('container', compiler).State.ExitCode, 0);
  const executable = join(out, 'instrumented-binary');
  docker(['cp', `${compiler}:/app/target/release/grandprix-forma`, executable]); chmodSync(executable, 0o755);
  report.instrumentedBinarySha256 = sha(readFileSync(executable));
  assert.notEqual(report.instrumentedBinarySha256, report.originalBinarySha256);
  remove(compiler);
  const originalUrl = await start(original), bodies = new Map();
  for (const rows of report.protocol.rows) {
    const { body, response } = await page(originalUrl, rows);
    assert.equal(response.headers.get('x-gp-walk-ns'), null, 'raced image was already instrumented');
    bodies.set(rows, body); writeFileSync(join(out, `original-${rows}.html`), body);
  }
  remove(original);
  const instrumentedContainer = create(runtime, ['--cpus=1', ...cpusetArgs, '--memory=1g', '-p', '127.0.0.1::3000',
    '--mount', `type=bind,src=${executable},dst=/usr/local/bin/grandprix,readonly`]);
  const instrumentedUrl = await start(instrumentedContainer);
  writeFileSync(join(out, 'instrumented-container.json'), JSON.stringify(inspect('container', instrumentedContainer), null, 2) + '\n');
  if (!diagnostic) {
    const deadline = Date.now() + 300_000;
    while (os.loadavg()[0] >= 2 && Date.now() < deadline && !stopping) await new Promise(resolve => setTimeout(resolve, 10_000));
    assert(!stopping && os.loadavg()[0] < 2, 'instrumented build did not settle');
  }
  report.measurementStarted = machine(); save();
  for (const rows of report.protocol.rows) {
    const observations = [];
    for (let index = 0; index < report.protocol.warmups + report.protocol.samples; index++) {
      const { response, body } = await page(instrumentedUrl, rows);
      assert(body.equals(bodies.get(rows)), 'instrumentation changed the original response body');
      const count = counts(response.headers, rows);
      assert(count.bytes <= body.length);
      if (index >= report.protocol.warmups) observations.push(count);
    }
    const first = observations[0];
    assert(observations.every(count => count.bytes === first.bytes && count.nodes === first.nodes));
    report.samples.push({ rows, documentBytes: bodies.get(rows).length, documentSha256: sha(bodies.get(rows)),
      sameBody: true, walkBytes: first.bytes, nodes: first.nodes, listIterations: first.rows,
      walkNs: stats(observations.map(count => count.ns)), nsPerByte: stats(observations.map(count => count.ns / count.bytes)), observations });
    save();
  }
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  report.cleanupErrors = [];
  for (const id of containers) try { remove(id); } catch (error) { report.cleanupErrors.push(String(error)); }
  if (report.cleanupErrors.length) process.exitCode = 1;
  report.after = machine(); save();
  console.log(JSON.stringify({ ...report, samples: report.samples.map(({ observations, ...summary }) => summary) }, null, 2));
}
