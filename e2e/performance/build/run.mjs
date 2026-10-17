#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { materialize, ROUTES, AFFECTED_ROUTES, REVISION, NEXT_REVISION, changeRevision, TIMED_ROUTE } from './workload.mjs';
import { POLICY, assertDependencyGraph, assertFreshApplication, assertPage, observeUpdate, aggregate, readSample } from './measurement.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const APP = join(HERE, 'app');
const ADMIN = join(APP, 'admin');
const GENERATED = join(ADMIN, 'src/generated');
const execute = promisify(execFile);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

async function sample(directory, sampleNumber, source, pilot) {
  assert(/^[a-f0-9]{40}$/.test(source), 'source must be an exact lowercase commit');
  assert(Number.isInteger(sampleNumber) && sampleNumber >= 1 && sampleNumber <= 20);
  mkdirSync(directory); // Never overwrite an earlier attempt.
  const result = { policy: POLICY, source, runId: process.env.GITHUB_RUN_ID ?? 'local', sample: sampleNumber, attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1), pilot, complete: false, commands: [], failures: [] };
  const processes = [];
  let browser;
  const env = { ...process.env, CARGO_TARGET_DIR: join(directory, 'target'), CARGO_INCREMENTAL: '0' };
  const checkpoint = () => save(join(directory, 'result.json'), result);
  async function command(label, executable, args, cwd = ROOT) {
    const started = now();
    let stdout = '', stderr = '', failure;
    try {
      ({ stdout, stderr } = await execute(executable, args, { cwd, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024 }));
    } catch (error) {
      stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error;
    } finally {
      writeFileSync(join(directory, `${label}.stdout`), stdout);
      writeFileSync(join(directory, `${label}.stderr`), stderr);
      result.commands.push({ label, executable, args, cwd, elapsedMs: now() - started, exit: failure?.code ?? 0, signal: failure?.signal ?? null });
      checkpoint();
    }
    if (failure) throw failure;
    return stdout;
  }
  function start(label, executable, args, cwd) {
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const owned = { child, text: '', fault: null, closed: false };
    owned.done = new Promise(resolve => child.once('close', (code, signal) => {
      owned.closed = true; owned.exit = { code, signal }; resolve();
    }));
    child.once('error', error => { owned.fault = error; });
    const receive = part => {
      appendFileSync(join(directory, `${label}.log`), part);
      owned.text += part.toString();
      if (owned.text.length > 8 * 1024 * 1024) owned.fault = new Error(`${label} log bound exceeded`);
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    processes.push(owned);
    return owned;
  }
  async function waitFor(owned, predicate, description) {
    const deadline = now() + 60_000;
    while (now() < deadline) {
      if (owned.fault) throw owned.fault;
      assert(!owned.closed, `${description}: process exited ${JSON.stringify(owned.exit)}`);
      if (predicate(owned.text)) return;
      await delay(10);
    }
    throw new Error(`${description}: readiness deadline`);
  }
  async function serve(binary, label) {
    const owned = start(label, binary, [], APP);
    await waitFor(owned, text => /FORMA_LISTENING http:\/\/127\.0\.0\.1:\d+/.test(text), label);
    return { owned, origin: /FORMA_LISTENING (http:\/\/127\.0\.0\.1:\d+)/.exec(owned.text)[1] };
  }
  async function stop(owned) {
    if (owned.closed) return;
    process.kill(-owned.child.pid, 'SIGTERM');
    await Promise.race([owned.done, delay(5_000, undefined, { ref: false }).then(() => { throw new Error('owned child did not close'); })]);
  }
  async function response(origin, route) {
    const reply = await fetch(origin + route, { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    assert.match(reply.headers.get('cache-control') ?? '', /no-store/);
    return { status: reply.status, html: await reply.text() };
  }
  async function verifyRoutes(origin, changed) {
    for (let i = 0; i < ROUTES.length; i++) {
      const reply = await response(origin, ROUTES[i]);
      assert.equal(reply.status, 200);
      assertPage(reply.html, i, changed && AFFECTED_ROUTES.includes(ROUTES[i]) ? NEXT_REVISION : REVISION);
      writeFileSync(join(directory, `${changed ? 'updated' : 'original'}-page${i}.html`), reply.html);
    }
  }
  try {
    assert.equal((await command('source', 'git', ['rev-parse', 'HEAD'])).trim(), source);
    assert.equal((await command('tracked-status', 'git', ['status', '--porcelain', '--untracked-files=no'])).trim(), '', 'tracked source must be clean');
    assert.equal(result.attempt, 1, 'no replacement attempts');
    assert(!existsSync(env.CARGO_TARGET_DIR) && !existsSync(join(ADMIN, 'dist')), 'fresh target and application output required');
    const rust = (await command('rust-version', 'rustc', ['--version'])).trim();
    result.profile = { platform: process.platform, arch: process.arch, node: process.version, rust, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), kernel: os.release(), cargoJobs: Number(env.CARGO_BUILD_JOBS), imageOS: env.ImageOS ?? '', imageVersion: env.ImageVersion ?? '' };
    if (!pilot) {
      assert.equal(result.profile.platform, 'linux'); assert.equal(result.profile.arch, 'x64');
      assert.equal(result.profile.logicalCpus, 4); assert.equal(result.profile.cargoJobs, 4);
      assert.equal(result.profile.node, 'v24.22.0'); assert.match(rust, /^rustc 1\.99\.1 /);
      assert.equal(result.profile.imageOS, 'ubuntu24');
    }
    result.inventory = materialize(GENERATED);
    cpSync(GENERATED, join(directory, 'sources'), { recursive: true });
    const metadata = JSON.parse(await command('metadata', 'cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'e2e/Cargo.toml']));
    const { appId } = assertDependencyGraph(metadata);
    const lockBefore = readFileSync(join(ROOT, 'e2e/Cargo.lock'));
    const setup = await command('dependency-setup-release', 'cargo', ['build', '--locked', '--release', '-p', 'forma-n7-dependencies', '--message-format=json-render-diagnostics', '--manifest-path', 'e2e/Cargo.toml']);
    assertFreshApplication(env.CARGO_TARGET_DIR, join(ADMIN, 'dist'), setup, appId);
    result.freshApplicationVerified = true;
    const fullStarted = now();
    await command('application-frontend', 'npm', ['run', 'build:ssr'], ADMIN);
    await command('application-release', 'cargo', ['build', '--locked', '--release', '-p', 'forma-n7-a9', '--manifest-path', 'e2e/Cargo.toml']);
    result.fullBuildMs = now() - fullStarted;
    checkpoint();
    // A release application must serve its embedded generation without disk
    // output. Keep those exact outputs as evidence; restore them for watch setup.
    const dist = join(ADMIN, 'dist'), hiddenDist = join(ADMIN, 'dist.embedding-proof');
    assert(!existsSync(hiddenDist), 'do not overwrite an earlier embedding proof');
    cpSync(dist, join(directory, 'release-output'), { recursive: true });
    renameSync(dist, hiddenDist);
    try {
      const release = await serve(join(env.CARGO_TARGET_DIR, 'release/forma-n7-a9'), 'release-server');
      await verifyRoutes(release.origin, false);
      await stop(release.owned);
      result.releaseEmbeddingVerified = true;
    } finally {
      assert(!existsSync(dist), 'an unexpected output appeared during embedding proof');
      renameSync(hiddenDist, dist);
    }
    // Debug compilation and initial watch/server/browser startup are setup for
    // the next edit. They are retained, never charged to the <1s edit interval.
    await command('application-debug-setup', 'cargo', ['build', '--locked', '-p', 'forma-n7-a9', '--manifest-path', 'e2e/Cargo.toml']);
    const watcher = start('watch', 'npm', ['run', 'dev:ssr'], ADMIN);
    await waitFor(watcher, text => text.includes('FORMA_N7_WATCH_READY'), 'all watch entries');
    const debug = await serve(join(env.CARGO_TARGET_DIR, 'debug/forma-n7-a9'), 'debug-server');
    await verifyRoutes(debug.origin, false);
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true });
    result.profile.chromium = browser.version();
    const page = await browser.newPage();
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await page.goto(debug.origin + TIMED_ROUTE);
    const counter = page.locator('[data-n7-component="Part00_00"]');
    await counter.getByRole('button', { name: 'Increment' }).click();
    await counter.locator('output').filter({ hasText: '8' }).waitFor();
    result.polls = [];
    const started = now();
    result.edit = changeRevision(GENERATED);
    result.update = await observeUpdate({
      started, now, read: () => response(debug.origin, TIMED_ROUTE), delay: () => delay(10),
      record: row => { result.polls.push(row); },
      reloadAndFrame: async () => {
        await page.reload({ waitUntil: 'load', timeout: 10_000 });
        assert.match(await page.locator('[data-n7-component="Shared00"]').innerText(), new RegExp(NEXT_REVISION));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      },
    });
    checkpoint();
    assert(!debug.owned.closed && !watcher.closed, 'watch/server exited during the edit');
    await verifyRoutes(debug.origin, true);
    cpSync(join(ADMIN, 'dist'), join(directory, 'updated-output'), { recursive: true });
    assert.deepEqual(browserErrors, [], 'browser errors invalidate the observation');
    assert.deepEqual(readFileSync(join(ROOT, 'e2e/Cargo.lock')), lockBefore, 'locked graph changed');
    result.semanticChecksPassed = true;
  } catch (error) {
    result.failures.push(error.stack ?? String(error));
  } finally {
    if (browser) try { await browser.close(); } catch (error) { result.failures.push(String(error)); }
    for (const owned of processes.reverse()) try { await stop(owned); } catch (error) { result.failures.push(String(error)); }
    result.closedProcesses = processes.map(p => ({ pid: p.child.pid, closed: p.closed, exit: p.exit }));
    result.complete = result.semanticChecksPassed === true && result.failures.length === 0 && processes.every(p => p.closed);
    checkpoint();
  }
  assert(result.complete, `N7 sample failed; retain ${join(directory, 'result.json')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [mode, directory, source, value] = process.argv.slice(2);
  try {
    if (mode === 'sample' || mode === 'pilot') await sample(resolve(directory), Number(value), source, mode === 'pilot');
    else if (mode === 'aggregate') {
      const samples = readdirSync(directory).filter(name => /^n7-sample-\d+$/.test(name)).map(name => readSample(join(directory, name)));
      const report = aggregate(samples, source);
      save(join(directory, 'aggregate.json'), report);
      assert(report.passed, 'N7 p95 threshold missed');
    } else throw new Error('expected sample|pilot|aggregate directory exact-source [sample-number]');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
