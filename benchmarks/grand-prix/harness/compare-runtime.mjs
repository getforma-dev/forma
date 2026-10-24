// Compare runtime bases using one immutable Linux release binary. No timings.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = key => argv.includes(`--${key}`) ? argv[argv.indexOf(`--${key}`) + 1] : undefined;
const source = option('source-image'), commit = option('source-commit'), builder = option('builder');
const id = process.env.GP_RUN_ID;
assert(/^sha256:[a-f0-9]{64}$/.test(source ?? ''), '--source-image requires the full immutable image ID');
assert(/^[a-f0-9]{40}$/.test(commit ?? ''), '--source-commit requires the exact framework commit');
assert(/^[a-z0-9-]+$/.test(id ?? ''), 'set this run\'s GP_RUN_ID');
assert(builder && /^[a-zA-Z0-9_.-]+$/.test(builder), '--builder requires an existing builder name');
assert(option('out'), '--out requires a fresh evidence directory');
const out = resolve(option('out'));
assert(!existsSync(out), 'runtime comparison evidence must be fresh');
mkdirSync(out, { recursive: true });
const context = join(out, 'context'); mkdirSync(context);
const sha = value => createHash('sha256').update(value).digest('hex');
const docker = args => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2 }).trim();
const inspect = (kind, name) => JSON.parse(docker([kind, 'inspect', name]))[0];
const labels = ['--label', 'grandprix=forma-264', '--label', `gp264run=${id}`];
const containers = new Set();
let image, child, stopping = false;
const report = { schema: 1, kind: 'runtime-base-comparison', sourceCommit: commit,
  measuredAt: new Date().toISOString(), host: `${process.platform}/${process.arch}`, kernel: os.release(),
  performanceQualified: false, note: 'Image sizes and correctness only; no boot, memory or throughput measurements.',
  sourceImage: source, sameBinary: false, passed: false };
const save = () => writeFileSync(join(out, 'runtime.json'), JSON.stringify(report, null, 2) + '\n');
save();
function run(args) {
  assert(!stopping, 'run interrupted');
  return new Promise((ok, fail) => {
    child = spawn('docker', args, { stdio: 'inherit' });
    child.once('error', fail);
    child.once('close', code => { child = undefined; code === 0 ? ok() : fail(Error(`docker exited ${code}`)); });
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(signal); });
function create(imageId) {
  assert(!stopping, 'run interrupted');
  const cid = docker(['create', ...labels, '--cpus=1', '--memory=1g', '-p', '127.0.0.1::3000', imageId]);
  containers.add(cid);
  return cid;
}
function remove(cid) { docker(['rm', '-f', cid]); containers.delete(cid); }
function normalized(body, headers) {
  // Only the nonce advertised by this same response may differ. No markup,
  // markers, row keys, whitespace or data are discarded for the comparison.
  const nonces = [...(headers['content-security-policy'] ?? '').matchAll(/'nonce-([^']+)'/g)].map(match => match[1]);
  let html = body, csp = headers['content-security-policy'] ?? '';
  for (const nonce of new Set(nonces)) { html = html.replaceAll(nonce, '<nonce>'); csp = csp.replaceAll(nonce, '<nonce>'); }
  return { html, policy: { 'content-type': headers['content-type'], 'cache-control': headers['cache-control'], csp,
    'x-content-type-options': headers['x-content-type-options'] } };
}
async function probe(cid, name) {
  docker(['start', cid]);
  const state = inspect('container', cid);
  assert.equal(state.HostConfig.NanoCpus, 1_000_000_000);
  assert.equal(state.HostConfig.Memory, 1024 ** 3);
  const port = state.NetworkSettings.Ports['3000/tcp'][0].HostPort;
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (!healthy && Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      healthy = response.status === 200 && await response.text() === 'ok';
    } catch {}
    if (!healthy) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(healthy, `${name}: /health did not return ok`);
  const pages = [];
  for (const rows of [10, 100, 1000]) {
    const response = await fetch(`${url}/ssr?rows=${rows}`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `${name}: ${rows}-row SSR status`);
    const body = await response.text(), headers = Object.fromEntries(response.headers);
    assert.match(headers['content-type'], /^text\/html/);
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal((/<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(body)?.[1].match(/<tr(?:\s|>)/g) ?? []).length, rows);
    writeFileSync(join(out, `${name}-${rows}.html`), body);
    writeFileSync(join(out, `${name}-${rows}-headers.json`), JSON.stringify(headers, null, 2) + '\n');
    pages.push({ rows, bytes: Buffer.byteLength(body), sha256: sha(body), normalized: normalized(body, headers) });
  }
  return pages;
}
try {
  const original = inspect('image', source);
  assert.equal(original.Id, source);
  assert.equal(original.Os, 'linux');
  assert.equal(original.Config.Labels?.grandprix, 'forma-264', 'source must be a Grand Prix round 2 image');
  report.original = { id: source, bytes: original.Size, architecture: original.Architecture, user: original.Config.User };
  writeFileSync(join(out, 'source-image.json'), JSON.stringify(original, null, 2) + '\n');
  const originalContainer = create(source);
  const binary = join(context, 'grandprix');
  docker(['cp', `${originalContainer}:/usr/local/bin/grandprix`, binary]);
  const bytes = readFileSync(binary);
  assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46', 'expected Linux ELF binary');
  report.binary = { bytes: bytes.length, sha256: sha(bytes) };
  const dockerfile = join(root, 'contestants/forma/Dockerfile.runtime');
  copyFileSync(dockerfile, join(context, 'Dockerfile'));
  report.runtimeDockerfileSha256 = sha(readFileSync(dockerfile));
  const tag = `gp264/${id}/forma-distroless`;
  assert.equal(docker(['image', 'ls', '-q', '--no-trunc', tag]), '', 'comparison image tag already exists');
  await run(['buildx', 'build', '--builder', builder, '--load', '--platform', `linux/${original.Architecture}`,
    ...labels, '--iidfile', join(out, 'image-id'), '-t', tag, context]);
  image = readFileSync(join(out, 'image-id'), 'utf8').trim();
  const comparison = inspect('image', image);
  assert.equal(comparison.Id, image);
  assert.equal(comparison.Architecture, original.Architecture);
  assert.equal(comparison.Config.Labels?.gp264run, id);
  assert.equal(comparison.Config.User, '65532');
  writeFileSync(join(out, 'distroless-image.json'), JSON.stringify(comparison, null, 2) + '\n');
  report.distroless = { id: image, bytes: comparison.Size, architecture: comparison.Architecture, user: comparison.Config.User };
  const comparisonContainer = create(image);
  const copied = join(out, 'distroless-binary');
  docker(['cp', `${comparisonContainer}:/usr/local/bin/grandprix`, copied]);
  assert.equal(sha(readFileSync(copied)), report.binary.sha256, 'runtime copy changed the binary');
  report.sameBinary = true;
  const originalPages = await probe(originalContainer, 'debian');
  remove(originalContainer);
  const comparisonPages = await probe(comparisonContainer, 'distroless');
  remove(comparisonContainer);
  assert.deepEqual(comparisonPages.map(page => page.normalized), originalPages.map(page => page.normalized), 'runtime bases changed SSR body or policy');
  report.pages = originalPages.map((page, index) => ({ rows: page.rows, originalBytes: page.bytes,
    originalSha256: page.sha256, distrolessBytes: comparisonPages[index].bytes, distrolessSha256: comparisonPages[index].sha256, sameNormalizedBodyAndPolicy: true }));
  report.imageBytesSaved = original.Size - comparison.Size;
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  report.cleanupErrors = [];
  for (const cid of containers) {
    try { remove(cid); } catch (error) { report.cleanupErrors.push(String(error)); }
  }
  if (image) {
    try { docker(['image', 'rm', image]); } catch (error) { report.cleanupErrors.push(String(error)); }
  }
  if (report.cleanupErrors.length) process.exitCode = 1;
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(report, null, 2));
}
