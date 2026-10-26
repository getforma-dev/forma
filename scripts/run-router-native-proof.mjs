#!/usr/bin/env node
// Reproducible source integration: real public build -> typed Rust server -> browsers.
// Every process is owned by this invocation and stopped before it returns.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(repo, 'experiments/forma-router-native');
const args = process.argv.slice(2);
let engines = 'chromium,firefox,webkit', outputDir = join(repo, 'test-results/router-native'), skipPackageBuild = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--engines') engines = args[++index] ?? '';
  else if (arg === '--output-dir') {
    const value = args[++index];
    if (!value) throw Error('--output-dir requires a path');
    outputDir = resolve(value);
  }
  else if (arg === '--skip-package-build') skipPackageBuild = true;
  else throw Error(`Unknown option: ${arg}`);
}
if (!engines || new Set(engines.split(',')).size !== engines.split(',').length || engines.split(',').some(engine => !['chromium','firefox','webkit'].includes(engine))) throw Error('Choose Chromium, Firefox and/or WebKit with --engines');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 22) throw Error('Use the repository-pinned Node 24 toolchain');
const runDir = join(outputDir, new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
await mkdir(runDir, { recursive: true });
process.chdir(repo);
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, CARGO_BUILD_JOBS: '3', CARGO_TARGET_DIR: join(fixture,'server/target') };
const children = new Set();
const commands = [];
let server, origin, status = 'running', interrupted = false;
const receipt = { startedAt: new Date().toISOString(), node: process.version, engines: engines.split(','), commands, scope: 'Source integration; no packed release or deployment qualification.' };
function owned(command, commandArgs, log, extra = {}) {
  commands.push({ command, args: commandArgs });
  const stream = createWriteStream(join(runDir, log), { flags: 'wx' });
  const child = spawn(command, commandArgs, { cwd: repo, env: { ...env, ...extra }, stdio: ['ignore','pipe','pipe'] });
  children.add(child); child.on('exit', () => children.delete(child));
  child.stdout.on('data', bytes => stream.write(bytes)); child.stderr.on('data', bytes => stream.write(bytes));
  child.on('close', () => stream.end());
  return child;
}
function completed(child) {
  return new Promise((resolveCompletion, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveCompletion() : reject(Error(`Child ${child.spawnfile} exited ${code ?? signal}`)));
  });
}
async function run(command, commandArgs, log, extra) { if (interrupted) throw Error('Proof run interrupted'); await completed(owned(command, commandArgs, log, extra)); }
function stop() { for (const child of children) child.kill('SIGTERM'); }
const interrupt = () => { interrupted = true; stop(); };
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
try {
  if (!skipPackageBuild) await run('npm', ['run','build'], 'packages.log');
  await run(process.execPath, [join(fixture,'build.mjs')], 'fixture-build.log');
  await run('cargo', ['build','--locked','--manifest-path',join(fixture,'server/Cargo.toml')], 'server-build.log');
  const binary = join(fixture, 'server/target/debug/forma-router-native-fixture');
  if (interrupted) throw Error('Proof run interrupted');
  server = owned(binary, [], 'server.log', { PORT:'0' });
  origin = await new Promise((resolveOrigin, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(Error('Fixture server did not publish its loopback origin within 15 seconds')), 15000);
    const failed = error => { clearTimeout(timer); reject(error); };
    server.once('error', failed); server.once('exit', () => failed(Error('Fixture server exited before readiness')));
    server.stdout.on('data', bytes => {
      text += bytes.toString();
      const match = text.match(/^http:\/\/127\.0\.0\.1:\d+$/m);
      if (match) { clearTimeout(timer); resolveOrigin(match[0]); }
    });
  });
  console.log(`Native fixture ${origin}; evidence ${runDir}`);
  await run(process.execPath, [join(fixture,'browser.mjs'),origin,join(runDir,'browser.json')], 'browser.log', { NATIVE_ENGINES:engines, NATIVE_CASE:'', NATIVE_SERVER_BINARY:binary });
  status = 'passed';
} catch (error) {
  status = 'failed'; receipt.error = String(error.stack ?? error); process.exitCode = 1;
  console.error(receipt.error);
} finally {
  const pending = [...children]; stop();
  await Promise.all(pending.map(child => new Promise(resolveExit => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); },3000);
    child.once('exit', () => { clearTimeout(timer); resolveExit(); });
  })));
  receipt.finishedAt = new Date().toISOString(); receipt.status = status; receipt.origin = origin; receipt.ownedProcessesStopped = [...children].every(child => child.exitCode !== null || child.signalCode !== null);
  if (!receipt.ownedProcessesStopped) { status = 'failed'; receipt.status = status; receipt.error = 'Owned child did not stop within cleanup deadline'; process.exitCode = 1; }
  await writeFile(join(runDir,'launcher.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({ status, runDir, ownedProcessesStopped:receipt.ownedProcessesStopped }));
}
