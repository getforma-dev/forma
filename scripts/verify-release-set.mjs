#!/usr/bin/env node
// P17 skeleton. Package code comes from DS11; the test harness and third-party tools come
// from the tagged tree's committed lock. No OIDC permission is needed here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { ROOT, NPM, CRATES, json, save, run, digest, stageNpmLock, stageCargoLock, assertCargoCandidateLock, packedRuntimeLock } from './release-set.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function server(binary, cwd, port, visit, refusal = false) {
  const child = spawn(binary, [], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = false, code;
  child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  child.once('error', e => { output += String(e); exited = true; });
  const closed = new Promise(resolve => child.once('close', c => { exited = true; code = c; resolve(); }));
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (exited) {
        assert(refusal && code !== 0 && /LOAD-/.test(output), `server exited unexpectedly: ${output}`);
        return;
      }
      let response;
      try { response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); }
      catch (e) { if (e.message !== 'fetch failed' && e.name !== 'TimeoutError') throw e; }
      if (response) {
        assert(!refusal, `corrupt module server accepted a connection: ${output}`);
        // Browser test timeouts are failures, not a reason to retry server readiness.
        return await visit(response, `http://127.0.0.1:${port}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`server never ${refusal ? 'refused start' : 'accepted a connection'}: ${output}`);
  } finally { if (!exited) child.kill('SIGTERM'); await closed; }
}
function unpack(file, dest) {
  mkdirSync(dest, { recursive: true });
  const names = run('tar', ['-tzf', file]).trim().split('\n');
  assert(names.every(n => !n.startsWith('/') && !n.split('/').includes('..')), 'unsafe archive path');
  run('tar', ['-xzf', file, '-C', dest, '--strip-components=1']);
}
export async function verify(dir, reportPath) {
  assert(!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'P17 must not have an OIDC credential');
  const started = Date.now(), set = json(join(dir, 'release-set.json'));
  for (const p of set.packages) assert.equal(digest(join(dir, p.file)), p.sha256, `${p.file}: wrong packed bytes`);
  const scratch = join(ROOT, `.release-verify-${process.pid}`);
  mkdirSync(scratch);
  const cli = mkdtempSync(join(tmpdir(), 'forma-packed-cli-'));
  const report = { schema: 1, commit: set.commit, passed: false, tests: [], pending: set.contracts.pending, signatures: 'registry dependencies via npm audit signatures; unpublished local artifacts via pinned DS11 SHA-256', templates: [] };
  const test = async (name, fn) => { console.log(`P17: ${name}`); const at = Date.now(); await fn(); report.tests.push({ name, passed: true, seconds: (Date.now() - at) / 1000 }); };
  try {
    for (const p of set.packages) {
      unpack(join(dir, p.file), p.name === '@getforma/create-app' ? cli : join(scratch, p.path));
      if (p.registry === 'crates') {
        const manifest = join(scratch, p.path, 'Cargo.toml');
        writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n[workspace]\n');
      }
    }
    await test('fresh advisories over every exact shipped crate lock', async () => {
      for (const p of set.packages.filter(p => p.registry === 'crates')) {
        const crate = join(scratch, p.path), manifest = join(crate, 'Cargo.toml'), lock = join(crate, 'Cargo.lock');
        const shippedLockSha256 = digest(lock);
        // Registry checksums for unpublished internal packages cannot resolve before upload.
        // Patch only those packages to the DS11 source and preserve all third-party locks.
        const text = readFileSync(lock, 'utf8');
        assertCargoCandidateLock(text, set.packages, p.name);
        const present = CRATES.filter(n => n !== p.name && text.includes(`name = "${n}"`));
        if (present.length) {
          writeFileSync(lock, stageCargoLock(text, set.packages, true, p.name));
          writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n[patch.crates-io]\n' + present.map(n => `${n} = { path = ${JSON.stringify(join(scratch, 'crates', n))} }`).join('\n') + '\n');
        }
        const auditLockSha256 = digest(lock);
        run('bash', ['scripts/check-advisories.sh', manifest], ROOT, { stdio: 'inherit' });
        assert.equal(digest(lock), auditLockSha256, `${p.name}: advisory check changed the recorded graph`);
        report.tests.push({ name: `${p.name}: packed Cargo.lock advisories`, passed: true, shippedLockSha256, auditLockSha256 });
      }
    });
    await test('packed CLI has an isolated, locked runtime dependency installation', async () => {
      const runtime = packedRuntimeLock(json(join(cli, 'package.json')), json(join(ROOT, 'package-lock.json')), 'packages/create-app');
      save(join(cli, 'package.json'), runtime.manifest); save(join(cli, 'package-lock.json'), runtime.lock);
      const lockHash = digest(join(cli, 'package-lock.json'));
      run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], cli, { stdio: 'inherit' });
      assert.equal(digest(join(cli, 'package-lock.json')), lockHash, 'npm changed the packed CLI runtime lock');
    });
    await test('packed compiler emits the frozen corpus read by packed forma-ir', async () => {
      const { generateRealIr } = await import(pathToFileURL(join(scratch, 'packages/compiler/dist/index.js')).href);
      const corpus = join(ROOT, 'packages/compiler/tests/fixtures/ir-corpus');
      const emitted = join(scratch, 'crates/forma-ir/tests/fixtures/js-emitter');
      const cases = readdirSync(corpus, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      assert(cases.length >= 14, 'the conformance corpus shrank');
      for (const name of cases) {
        const entry = ['app.ts', 'app.tsx'].map(f => join(corpus, name, f)).find(existsSync);
        const result = generateRealIr(entry);
        assert(result && !result.islands.some(i => i.name === 'createList' || /^island_\d+$/.test(i.name)), `${name}: compiler fell back to placeholder`);
        const bytes = result.binary;
        assert(bytes, `${name}: compiler result has no IR bytes`);
        assert.deepEqual(Buffer.from(bytes), readFileSync(join(emitted, `${name}.ir`)), `${name}: emitted bytes differ from packed reader corpus`);
      }
      run('cargo', ['test', '--locked', '--manifest-path', join(scratch, 'crates/forma-ir/Cargo.toml'), '--test', 'js_emitter_contract'], ROOT, { stdio: 'inherit' });
    });
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      for (const template of ['minimal', 'dashboard']) {
        await test(`${template}: packed CLI, locked install, signatures, build, serve and interaction`, async () => {
          const name = `release-${template}`;
          run(process.execPath, [join(cli, 'dist/index.js'), name, '--template', template], scratch, { env: { ...process.env, NODE_PATH: '' } });
          const project = join(scratch, name), admin = join(project, 'admin');
          const staged = stageNpmLock(json(join(admin, 'package.json')), json(join(admin, 'package-lock.json')), set.packages, dir, true);
          save(join(admin, 'package.json'), staged.manifest); save(join(admin, 'package-lock.json'), staged.lock);
          const npmHash = digest(join(admin, 'package-lock.json'));
          run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], admin, { stdio: 'inherit' });
          run('npm', ['audit', 'signatures'], admin, { stdio: 'inherit' });
          for (const p of set.packages.filter(p => p.registry === 'npm' && p.name !== '@getforma/create-app')) {
            const manifest = join(admin, 'node_modules', p.name, 'package.json');
            if (existsSync(manifest)) assert.equal(json(manifest).version, p.version, `${template} installed another ${p.name}`);
          }
          run('npm', ['run', template === 'minimal' ? 'build:ssr' : 'build'], admin, { stdio: 'inherit' });
          assert.equal(digest(join(admin, 'package-lock.json')), npmHash, 'npm changed the candidate lock');
          // Substitute just the candidate crate sources, never the registry's already-published
          // version. The dependency graph and all third-party checksums stay locked.
          let lock = readFileSync(join(project, 'Cargo.lock'), 'utf8');
          const present = CRATES.filter(n => lock.includes(`name = "${n}"`));
          lock = stageCargoLock(lock, set.packages, true);
          writeFileSync(join(project, 'Cargo.lock'), lock);
          const patch = '\n[workspace]\n\n[patch.crates-io]\n' + present.map(n => `${n} = { path = ${JSON.stringify(join(scratch, 'crates', n))} }`).join('\n') + '\n';
          writeFileSync(join(project, 'Cargo.toml'), readFileSync(join(project, 'Cargo.toml'), 'utf8') + patch);
          const port = await freePort(), main = join(project, 'src/main.rs');
          const source = readFileSync(main, 'utf8');
          const listener = template === 'minimal' ? '127.0.0.1:3000' : '{host}:3000';
          assert(source.includes(listener), 'template listener changed; update P17 adapter');
          writeFileSync(main, source.replaceAll(listener, `127.0.0.1:${port}`));
          run('cargo', ['build', '--locked'], project, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: join(scratch, 'target') } });
          const binary = join(scratch, 'target/debug', name);
          await server(binary, project, port, async (response, origin) => {
            assert.equal(response.status, 200);
            const html = await response.text();
            assert(!html.includes('<div id="app"></div>') || template === 'dashboard', 'minimal SSR is an empty shell');
            const page = await browser.newPage();
            page.setDefaultTimeout(15_000);
            const errors = []; page.on('pageerror', e => errors.push(e.message));
            try {
              await page.goto(origin, { waitUntil: 'networkidle', timeout: 20_000 });
              if (template === 'minimal') {
                await page.getByRole('button', { name: 'Increment', exact: true }).click();
                await page.locator('.count').filter({ hasText: 'Count: 1' }).waitFor();
              } else {
                await page.getByRole('button', { name: /^Deployments(?:\s|$)/ }).click();
                await page.locator('h1').filter({ hasText: 'Deployments' }).waitFor();
              }
              const assertActivated = async () => assert.equal(await page.locator('[data-forma-status="pending"], [data-forma-status="hydrating"], [data-forma-status="error"]').count(), 0, 'island did not activate after load');
              await assertActivated();
              // Real DOM negative control: the gate must reject the runtime's actual marker.
              await page.evaluate(() => { const el = document.createElement('div'); el.id = 'p17-pending-probe'; el.setAttribute('data-forma-status', 'pending'); document.body.append(el); });
              await assert.rejects(assertActivated, /did not activate/);
              await page.locator('#p17-pending-probe').evaluate(el => el.remove());
              await assertActivated();
              assert.deepEqual(errors, [], 'browser error in packed template');
            } finally { await page.close(); }
          });
          if (template === 'minimal') {
            const manifest = json(join(admin, 'dist/manifest.json'));
            const ir = join(admin, 'dist', manifest.routes['/'].ir);
            const bytes = readFileSync(ir); writeFileSync(ir, bytes.subarray(0, 12));
            await server(binary, project, port, async () => {}, true);
            writeFileSync(ir, bytes);
            report.tests.push({ name: 'packed loader refuses a corrupt module before binding', passed: true });
          }
          report.templates.push({ template, npmLockSha256: npmHash, packedPackages: set.packages.map(p => `${p.name}@${p.version}`) });
        });
      }
    } finally { await browser.close(); }
    // New contracts must provide their tests before the milestone enables live publication.
    // A2 dry runs deliberately exercise the existing contracts without claiming future coverage.
    if (!set.dryRun) assert.equal(set.contracts.liveReleaseReady, true, 'new milestone contract tests are still pending; nothing may publish');
    report.passed = true;
    report.elapsedSeconds = (Date.now() - started) / 1000;
    save(reportPath, report);
  } finally {
    if (!report.passed) save(reportPath, { ...report, elapsedSeconds: (Date.now() - started) / 1000 });
    // Keep logs/report outside scratch; remove only this invocation's own output.
    rmSync(scratch, { recursive: true, force: true });
    rmSync(cli, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verify(resolve(process.argv[2]), resolve(process.argv[3])).catch(e => { console.error(`P17: ${e.stack}`); process.exitCode = 1; });
