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
const profileReports = new Map();
let writes = Promise.resolve();
function collectProfiles() {
  const rows = profiles.map(profile => profileReports.get(profile)).filter(Boolean);
  for (const key of ['cases', 'capabilities', 'explicitMount', 'observers', 'pageErrors', 'requests']) {
    report[key] = rows.flatMap(row => row[key]);
  }
  report.profileRuns = rows.map(row => ({ profile: row.profile, passed: row.passed,
    startedAt: row.startedAt, finishedAt: row.finishedAt, runtimeSha256: row.runtimeSha256,
    policy: row.policy, origin: row.origin, otherOrigin: row.otherOrigin, cleanupComplete: row.cleanupComplete,
    ...(row.error ? { error: row.error } : {}) }));
  // Preserve the serial selector control's first-failure observation and a
  // deterministic profile order even when two independent profiles overlap.
  const observation = rows.find(row => row.error) ?? rows.at(-1);
  if (observation?.current) report.current = observation.current;
  if (observation?.lastObservation) report.lastObservation = observation.lastObservation;
  report.policy = rows[0]?.policy;
}
const save = () => {
  collectProfiles();
  const bytes = JSON.stringify(report, null, 2) + '\n';
  // Each checkpoint is a snapshot, and writes finish in invocation order.
  // A write failure stays a failure; no later success can overwrite it.
  writes = writes.then(() => writeFile(output, bytes));
  return writes;
};
const started = performance.now();
let browser, runtimeSha256;

async function runProfile(profile) {
  // A profile owns both origins, its request journal, browser context and all
  // observers. Cases within it remain sequential with the original two-frame
  // observation window; another profile cannot supply or hide its requests.
  const report = { profile, passed: false, startedAt: new Date().toISOString(),
    cases: [], capabilities: [], explicitMount: [], observers: [], pageErrors: [], requests: [], cleanupComplete: false };
  profileReports.set(profile, report);
  let server, other, page;
  try {
    other = await startServer(runtimePath, '', report.requests);
    server = await startServer(runtimePath, other.url, report.requests);
    assert.equal(server.runtimeSha256, runtimeSha256, 'profile runtime changed');
    assert.equal(other.runtimeSha256, runtimeSha256, 'other-origin runtime changed');
    report.runtimeSha256 = server.runtimeSha256;
    report.policy = server.policy; report.origin = server.url; report.otherOrigin = other.url;
    page = await browser.newPage();
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
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
  } finally {
    const failures = [];
    try { await page?.close(); } catch (error) { failures.push(error); }
    const closed = await Promise.allSettled([server?.close(), other?.close()]);
    failures.push(...closed.filter(row => row.status === 'rejected').map(row => row.reason));
    report.cleanupComplete = failures.length === 0;
    if (failures.length) {
      report.passed = false;
      report.error = [report.error, ...failures.map(error => String(error))].filter(Boolean).join('\n');
    }
    report.finishedAt = new Date().toISOString();
  }
  return report;
}

try {
  runtimeSha256 = createHash('sha256').update(await readFile(runtimePath)).digest('hex');
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
  report.runtimePath = runtimePath;
  report.runtimeSha256 = runtimeSha256;
  browser = await chromium.launch();
  report.browser = browser.version();
  // The full matrix uses at most two isolated browser contexts. Keep selectors
  // serial: the real removed-grant control must retain its first failing profile.
  const concurrency = only ? 1 : 2;
  report.profileConcurrency = concurrency;
  for (let index = 0; index < profiles.length; index += concurrency) {
    const completed = await Promise.all(profiles.slice(index, index + concurrency).map(runProfile));
    await save();
    const failure = completed.find(row => !row.passed);
    if (failure) throw new Error(failure.error ?? `${failure.profile}: profile did not complete`);
  }
  collectProfiles();
  assert.equal(report.cases.length, selected.length);
  assert.equal(report.capabilities.length, capabilities.length);
  assert.deepEqual(report.cases.map(item => item.id).sort(), selected.map(item => item.id).sort(), 'executed Cartesian product differs');
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.profileRuns.length, profiles.length);
  assert(report.profileRuns.every(row => row.passed && row.cleanupComplete), 'profile cleanup did not complete');
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  report.elapsedMs = performance.now() - started;
  await browser?.close();
  await save();
  process.stdout.write(JSON.stringify({ passed: report.passed, completeMatrix: report.completeMatrix, cases: report.cases.length, capabilities: report.capabilities.length, elapsedMs: report.elapsedMs, error: report.error }) + '\n');
}
