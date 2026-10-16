#!/usr/bin/env node
// Bounded, reproducible source campaign. It emits no browser/runtime package.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = /^--(seed|cases|out|timeout-ms)=(.+)$/.exec(arg);
  if (!match || args.has(match[1])) throw new Error(`invalid or duplicate argument ${arg}`);
  args.set(match[1], match[2]);
}
function integer(key, fallback, min, max) {
  const raw = args.get(key) ?? String(fallback);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) throw new Error(`invalid ${key}`);
  return Number(raw);
}
const seed = integer('seed', 1290300, 0, 0xffff_ffff);
const count = integer('cases', 100_000, 58, 1_000_000);
const timeoutMs = integer('timeout-ms', 120_000, 100, 600_000);
const output = resolve(root, args.get('out') ?? 'fuzz/expressions/out/report.json');
await mkdir(dirname(output), { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'forma-expr-fuzz-'));
const files = [];
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
}
await walk(join(root, 'src/expr'));
const sourceHash = createHash('sha256');
for (const path of files.sort()) sourceHash.update(relative(root, path) + '\0').update(await readFile(path));
const metadata = {
  schema: 1, seed, cases: count, timeoutMs, node: process.version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceClean: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '',
  sourceSha256: sourceHash.digest('hex'),
};
try {
  const bundle = join(temporary, 'worker.mjs');
  await build({ entryPoints: [join(root, 'src/expr/__tests__/fuzz/worker.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' });
  metadata.workerSha256 = createHash('sha256').update(await readFile(bundle)).digest('hex');
  const metadataFile = join(temporary, 'metadata.json');
  await writeFile(metadataFile, JSON.stringify(metadata));
  // A child that fails before its first batch cannot leave a prior pass behind.
  await writeFile(output, JSON.stringify({ ...metadata, passed: false, status: 'starting' }, null, 2) + '\n');
  const child = spawn(process.execPath, [bundle, String(seed), String(count), output, metadataFile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let bytes = 0;
  let termination;
  const stop = reason => { termination ??= reason; child.kill('SIGKILL'); };
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 262_144) stop('output-limit');
    else (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
  });
  let code;
  try {
    code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
  } finally {
    clearTimeout(timer);
  }
  if (termination) {
    let partial;
    try { partial = JSON.parse(await readFile(output, 'utf8')); } catch { /* no complete batch yet */ }
    await writeFile(output, JSON.stringify({ ...metadata, passed: false, status: termination, partial }, null, 2) + '\n');
    throw new Error(`expression campaign ${termination}; partial evidence at ${output}`);
  }
  const report = JSON.parse(await readFile(output, 'utf8'));
  if (code !== 0 || report.passed !== true || report.report?.completed !== count) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
