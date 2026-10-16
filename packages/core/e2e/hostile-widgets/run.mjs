#!/usr/bin/env node
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, profiles } from './catalogue.mjs';
import { startServer } from './server.mjs';
import { runBrowserCase } from './browser-case.mjs';
import { installObservers, observerControls } from './observers.mjs';
import { capabilityCases, runCapability } from './capabilities.mjs';
import { runExplicitControls } from './explicit-controls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = new Map();
for (const raw of process.argv.slice(2)) {
  const match = /^--(only|runtime|out)=(.+)$/.exec(raw);
  if (!match || args.has(match[1])) throw new Error(`invalid or duplicate argument ${raw}`);
  args.set(match[1], match[2]);
}
const only = args.get('only') ?? null;
const runtimePath = resolve(args.get('runtime') ?? join(root, 'dist/formajs-runtime.global.js'));
const output = resolve(args.get('out') ?? join(here, 'out', only ? 'pilot.json' : 'qualification.json'));
await mkdir(dirname(output), { recursive: true });
const catalogue = cases();
const selected = only ? catalogue.filter(item => item.id.includes(only)) : catalogue;
const capabilities = capabilityCases.flatMap(item => profiles.map(profile => ({ item, profile, id: `${item.id}/${profile}` }))).filter(item => !only || item.id.includes(only));
assert.ok(selected.length + capabilities.length > 0, 'pilot selection must execute a real case');
const report = { schema: 1, passed: false, completeMatrix: !only, selection: only, node: process.version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceClean: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '',
  catalogueSha256: createHash('sha256').update(JSON.stringify(catalogue)).digest('hex'),
  requested: selected.length, requestedCapabilityControls: capabilities.length, cases: [], capabilities: [], explicitMount: [], observers: [], pageErrors: [], requests: [] };
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
const started = performance.now();
let server, other, browser;
try {
  const sourceFiles = ['catalogue.mjs', 'browser-case.mjs', 'capabilities.mjs', 'observers.mjs', 'server.mjs', 'run.mjs', 'probe-provenance.json', 'explicit-controls.mjs'];
  report.harnessSources = {};
  for (const name of sourceFiles) report.harnessSources[name] = createHash('sha256').update(await readFile(join(here, name))).digest('hex');
  const provenance = JSON.parse(await readFile(join(here, 'probe-provenance.json'), 'utf8'));
  for (const inventory of [provenance.historical, provenance.a2, provenance.current]) {
    const bytes = await readFile(resolve(root, '../..', inventory.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), inventory.sha256, 'frozen probe inventory changed');
    assert.equal(JSON.parse(bytes).length, inventory.total, 'probe total must match authenticated source');
    const originals = JSON.parse(bytes).filter(item => inventory !== provenance.current || item.tags.includes('security'));
    assert.deepEqual(inventory.rows.map(item => item.id), originals.map(item => item.id), 'every original probe must have a disposition');
  }
  report.provenance = { historical: provenance.historical.total, a2: provenance.a2.total, retiredA2: provenance.a2.rows.filter(row => row.disposition.kind === 'retired-api').length, current: provenance.current.total, currentSecurity: provenance.current.rows.length };
  const requests = [];
  other = await startServer(runtimePath, '', requests);
  server = await startServer(runtimePath, other.url, requests);
  report.runtimePath = runtimePath;
  report.runtimeSha256 = server.runtimeSha256;
  report.policy = server.policy;
  browser = await chromium.launch();
  report.browser = browser.version();
  for (const profile of profiles) {
    const page = await browser.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    const response = await page.goto(server.url);
    assert.equal(response.headers()['content-security-policy'], server.policy);
    assert.deepEqual(await page.evaluate(installObservers), { trustedTypes: true, runtime: true });
    const observer = await page.evaluate(observerControls);
    assert.deepEqual(observer, { executions: 1, secret: 'secret-1290300', outsideReads: 1, response: 200, unexpectedResponse: 404, trustedTypesRefused: true });
    assert.deepEqual(server.requests.slice(-2).map(request => request.path), ['/api/observer-control', '/observer-unexpected']);
    report.observers.push({ profile, ...observer });
    if (!only) {
      const before = server.requests.length;
      const controls = await page.evaluate(runExplicitControls, profile);
      assert.equal(server.requests.length, before, 'omitted grants sent a request');
      for (const control of controls) {
        if (control.id.startsWith('no-auto/')) assert.deepEqual(control, { id: `no-auto/${profile}`, served: 'raw', injected: 'raw' });
        else {
          assert.equal(control.live, true); assert.equal(control.reach, 'confined');
          assert.equal(control.failed, 'data-fetch denied: the mount grants no fetch');
          assert.equal(control.activations, 0); assert.equal(control.outsideReads, 0);
          assert.deepEqual(control.codes, ['FORMA_E_GRANT_FETCH', 'FORMA_E_GRANT_NAVIGATE']);
        }
      }
      report.explicitMount.push(...controls.map(control => ({ ...control, unauthorizedRequests: 0 })));
    }
    for (const input of selected.filter(item => item.profile === profile)) {
      const before = server.requests.length;
      report.current = input;
      const result = await page.evaluate(runBrowserCase, input);
      assert.equal(server.requests.length, before, `${input.id}: unauthorized request`);
      report.cases.push({ ...result, unauthorizedRequests: server.requests.length - before });
      if (report.cases.length % 50 === 0) await save();
    }
    for (const planned of capabilities.filter(item => item.profile === profile)) {
      const input = { ...planned, otherOrigin: other.url, item: { ...planned.item, ...(planned.item.path ? { path: planned.item.path.replace('$OTHER', other.url) } : {}) } };
      const before = server.requests.length;
      report.current = input;
      const result = await page.evaluate(runCapability, input);
      report.lastObservation = result;
      const requests = server.requests.slice(before);
      assert.equal(result.live, true, 'capability mount must be active');
      if (input.item.method) {
        const allowed = !input.item.never && (profile === 'all' || profile === 'typical' && input.item.typical);
        if (allowed && !input.item.redirect) {
          assert.equal(result.result, 'true'); assert.equal(requests.length, 1);
          assert.equal(requests[0].method, input.item.method);
          assert.equal(requests[0].path, new URL(input.item.path, server.url).pathname);
          assert.equal(requests[0].cookie, profile === 'all' && !input.item.other ? 'hostile_fixture=secret' : '');
          assert.equal(requests[0].origin, input.item.other ? other.url : server.url);
        } else if (allowed && input.item.redirect) {
          assert.equal(requests.length, 1, 'redirect must not send a second request');
          assert.equal(requests[0].path, '/api/widget/redirect');
          assert.equal(requests.some(request => request.path.startsWith('/api/admin/')), false, 'redirect escaped the granted path');
          assert.equal(result.failed, 'FORMA_E_FETCH_REQUEST: data-fetch failed before a response; redirects are not followed');
          assert.notEqual(result.result, 'true');
        } else { assert.equal(requests.length, 0, 'denied fetch sent a request'); assert.ok(result.failed); }
        assert.equal(result.outsideReads, 0);
      } else if (input.item.id === 'activation') {
        assert.equal(result.submits, profile === 'all' ? 1 : 0);
        if (profile !== 'all') assert.ok(result.codes.includes(input.item.code));
      } else {
        if (profile !== 'all') assert.equal(result.outsideReads, 0, 'unauthorized outside-root read');
        assert.equal(result.value, profile === 'all' ? input.item.allowed : input.item.denied);
        if (profile === 'all') assert.ok(result.outsideReads > 0, 'granted read observer must be reached');
        else { assert.equal(result.outsideReads, 0); if (input.item.code) assert.ok(result.codes.includes(input.item.code)); }
      }
      report.capabilities.push({ ...result, requests });
    }
    await page.close();
  }
  assert.equal(report.cases.length, selected.length);
  assert.equal(report.capabilities.length, capabilities.length);
  assert.deepEqual(report.cases.map(item => item.id).sort(), selected.map(item => item.id).sort(), 'executed Cartesian product differs');
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  report.elapsedMs = performance.now() - started;
  report.requests = server?.requests ?? [];
  await browser?.close();
  await server?.close();
  await other?.close();
  await save();
  process.stdout.write(JSON.stringify({ passed: report.passed, completeMatrix: report.completeMatrix, cases: report.cases.length, capabilities: report.capabilities.length, elapsedMs: report.elapsedMs, error: report.error }) + '\n');
}
