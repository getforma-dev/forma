import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { recordEvidence, EVIDENCE_MANIFEST } from './release-evidence.mjs';
import { placeholderPlan, validatePlaceholderPlan, validatePlaceholderArchive, validatePlaceholderReceipt,
  authenticatePlaceholderHost, prepareProviderPlaceholder, consumeProviderPlaceholder, PLACEHOLDER_HOST, PLACEHOLDER_PLAN_PATH } from './release-provider-placeholder.mjs';
import { actualPlaceholderBytes, placeholderFixture } from './fixtures/provider-placeholder.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receiptOptions = f => ({ hostTag: PLACEHOLDER_HOST, hostCommit: f.receipt.recordedBy.commit, hostRunId: String(f.receipt.recordedBy.runId), binding: f.binding });
test('actual 364-byte npm holding artifact matches the finite source plan without being product evidence', () => {
  const f = placeholderFixture(); validatePlaceholderArchive(actualPlaceholderBytes, f.binding.plan);
  validatePlaceholderReceipt(f.receipt, receiptOptions(f));
  assert.equal(actualPlaceholderBytes.length, 364); assert.equal(f.receipt.performanceBaselineEligible, false);
});
for (const [name, change] of [
  ['broader identity', p => { p.name = '@getforma/core'; }], ['new version', p => { p.version = '0.0.1-stage'; }],
  ['arbitrary host', p => { p.hostTag = 'v3.2.0'; }], ['different actual bytes', p => { p.archive.sha256 = '0'.repeat(64); }],
  ['more members', p => { p.members.push({ name: 'index.js', bytes: 1, sha256: 'a'.repeat(64) }); }],
  ['qualification promotion', p => { p.qualificationEligible = true; }], ['invented stage cause', p => { p.evidence.causality = 'explicit stage'; }],
]) test(`finite plan rejects ${name}`, () => { const p = structuredClone(placeholderPlan().plan); change(p); assert.throws(() => validatePlaceholderPlan(p)); });
for (const [name, change] of [
  ['extra field', r => { r.qualified = true; }], ['changed archived bytes', r => { r.observation.archiveBase64 = Buffer.from('altered').toString('base64'); }],
  ['rehashed wrong source plan', r => { r.planSha256 = '0'.repeat(64); }], ['metadata stub removed', r => { r.observation.metadata.stub = false; }],
  ['publication time changed', r => { r.observation.publishedAt = '2026-10-27T02:07:02.211Z'; }],
  ['digest mutation', r => { r.observation.metadata.dist.shasum = '0'.repeat(40); }], ['other recorder run', r => { r.recordedBy.runId++; }],
  ['future preparation', r => { r.preparedBy.runAttempt = 3; }], ['soak promotion', r => { r.soakEligible = true; }],
  ['ordinary release disposition', r => { r.disposition = 'qualified'; }],
  ['invented transfer hash', r => { r.preparedManifestSha256 = '0'.repeat(64); }],
  ['changed canonical preparation text', r => { r.prepared.content += ' '; }],
  ['changed retained manifest text', r => { r.prepared.manifest += ' '; }],
]) test(`receipt rejects ${name}`, () => { const f = placeholderFixture(), options = receiptOptions(f); change(f.receipt); assert.throws(() => validatePlaceholderReceipt(f.receipt, options)); });

const authenticate = f => authenticatePlaceholderHost({ receipt: f.receipt, binding: f.binding, get: async url => { assert(f.provider.has(url), `unexpected URL ${url}`); return f.provider.get(url); } });
test('consumer requires actual successful host run, annotated tag, recorder job and matching source plan', async () => { await authenticate(placeholderFixture()); });
for (const [name, mutate] of [
  ['unsuccessful latest run', f => { [...f.provider.values()][0].conclusion = 'failure'; }],
  ['wrong attempt', f => { f.run.run_attempt = 1; }], ['wrong source', f => { f.run.head_sha = 'b'.repeat(40); }],
  ['failed record job', f => { f.jobs.jobs[0].conclusion = 'failure'; }],
  ['provider copy instead of recorder execution', f => { f.jobs.jobs[0].started_at = '2026-10-27T06:00:00Z'; }],
  ['duplicate recorder', f => { f.jobs.jobs.push(structuredClone(f.jobs.jobs[0])); f.jobs.total_count++; }],
  ['different tagged source', f => { [...f.provider.values()].find(v => v.tag)?.object && ([...f.provider.values()].find(v => v.tag).object.sha = 'e'.repeat(40)); }],
  ['replaced committed plan', f => { const source = [...f.provider.values()].find(v => v.type === 'file'); source.content = Buffer.from('{}').toString('base64'); source.size = 2; }],
  ['failed original check', f => { f.checkJobs.jobs[0].conclusion = 'failure'; }],
  ['missing preparation step', f => { f.checkJobs.jobs[0].steps.shift(); }],
  ['unsuccessful upload', f => { f.checkJobs.jobs[0].steps[1].conclusion = 'skipped'; }],
  ['copy labeled as original check', f => { f.checkJobs.jobs[0].started_at = '2026-10-27T05:58:00Z'; }],
  ['observation outside preparation interval', f => { f.checkJobs.jobs[0].steps[0].completed_at = '2026-10-27T05:59:59Z'; }],
  ['upload after recorder started', f => { f.checkJobs.jobs[0].completed_at = '2026-10-27T07:03:00Z'; f.checkJobs.jobs[0].steps[1].completed_at = '2026-10-27T07:02:30Z'; }],
]) test(`consumer refuses ${name}`, async () => { const f = placeholderFixture(); mutate(f); await assert.rejects(authenticate(f)); });
test('later host attempts remain separate observations without replacing the original successful recorder', async () => {
  for (const [status, conclusion] of [['completed', 'success'], ['completed', 'failure'], ['in_progress', null]]) {
    const f = placeholderFixture(), latest = [...f.provider.values()][0]; latest.run_attempt = 3; latest.status = status; latest.conclusion = conclusion;
    const observed = await authenticate(f); assert.equal(observed.recorded.runAttempt, 2); assert.deepEqual(observed.latestObserved, { runAttempt: 3, status, conclusion });
  }
});

function localPreparation(t) {
  const root = mkdtempSync(join(tmpdir(), 'forma-placeholder-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/release'), { recursive: true });
  copyFileSync(new URL('../docs/release/npm-provider-placeholder-router.json', import.meta.url), join(root, PLACEHOLDER_PLAN_PATH));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'offline finite plan fixture']);
  git(['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid', 'tag', '-a', PLACEHOLDER_HOST, '-m', 'offline fixture only']); const commit = git(['rev-parse', 'HEAD']), f = placeholderFixture(commit);
  const calls = []; let activeAttempt = 1;
  const epoch = Date.now(), iso = offset => new Date(epoch + offset * 1000).toISOString();
  const check = f.checkJobs.jobs[0]; check.started_at = iso(-60); check.completed_at = iso(8);
  Object.assign(check.steps[0], { started_at: iso(-30), completed_at: iso(5) });
  Object.assign(check.steps[1], { started_at: iso(6), completed_at: iso(7) });
  f.checkRun.run_started_at = iso(-120);
  const currentRecord = attempt => ({ ...f.jobs.jobs[0], run_attempt: attempt, status: 'in_progress', conclusion: null, started_at: iso(10), completed_at: null });
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (url.startsWith('https://api.github.com/')) {
      const requested = Number(/\/attempts\/(\d+)/.exec(url)?.[1]);
      if (url.includes('/jobs?')) {
        const jobs = requested === 1 ? [check, ...(activeAttempt === 1 ? [currentRecord(1)] : [])] : [currentRecord(activeAttempt)];
        return new Response(JSON.stringify({ total_count: jobs.length, jobs }));
      }
      return new Response(JSON.stringify(requested === activeAttempt
        ? { ...f.run, run_attempt: activeAttempt, status: 'in_progress', conclusion: null, run_started_at: iso(activeAttempt === 1 ? -120 : 9) }
        : f.checkRun));
    }
    if (url.endsWith('/%40getforma%2Frouter')) return new Response(JSON.stringify({ name: f.binding.plan.name, versions: { '0.0.0-stage': f.metadata }, time: { '0.0.0-stage': f.binding.plan.metadata.publishedAt } }));
    assert.equal(url, f.binding.plan.archive.url); return new Response(actualPlaceholderBytes);
  };
  const args = { tag: PLACEHOLDER_HOST, commit, runId: 12345, runAttempt: 1, root, directory: join(root, 'prepared'), fetchImpl, token: 'offline-github-token' };
  return { root, args, calls, setAttempt: value => { activeAttempt = value; } };
}
test('preparation and record retry preserve original proof with independently anchored transfer and no registry credential', async t => {
  const f = localPreparation(t), prepared = await prepareProviderPlaceholder(f.args); f.setAttempt(2);
  const result = await consumeProviderPlaceholder({ ...f.args, runAttempt: 2, expectedSha256: prepared.manifestSha256, outputDirectory: join(f.root, 'output') });
  assert.equal(result.assets.length, 1); const receipt = JSON.parse(readFileSync(result.assets[0]));
  assert.equal(receipt.preparedBy.runAttempt, 1); assert.equal(receipt.recordedBy.runAttempt, 2);
  for (const call of f.calls.filter(row => row.url.startsWith('https://registry.'))) assert.equal(new Headers(call.headers).get('authorization'), null);
  assert.equal(result.providerPlaceholders[0].sha256, sha(readFileSync(result.assets[0])));
});
test('same-attempt active recorder accepts the completed check without claiming overall success early', async t => {
  const f = localPreparation(t), prepared = await prepareProviderPlaceholder(f.args);
  const result = await consumeProviderPlaceholder({ ...f.args, expectedSha256: prepared.manifestSha256, outputDirectory: join(f.root, 'output') });
  const receipt = JSON.parse(readFileSync(result.assets[0])); assert.equal(receipt.preparedBy.runAttempt, receipt.recordedBy.runAttempt);
  assert.equal(Object.hasOwn(receipt, 'runConclusion'), false);
});
test('malformed preparation fails before publication and changed transfer or rehashed metadata is refused', async t => {
  const f = localPreparation(t); const originalFetch = f.args.fetchImpl;
  await assert.rejects(prepareProviderPlaceholder({ ...f.args, fetchImpl: async (url, opts) => url.endsWith('.tgz') ? new Response('missing', { status: 404 }) : originalFetch(url, opts) }));
  const prepared = await prepareProviderPlaceholder(f.args), path = join(f.args.directory, 'prepared.json');
  const value = JSON.parse(readFileSync(path)); value.observation.metadata.stub = false; writeFileSync(path, JSON.stringify(value));
  const args = { ...f.args, expectedSha256: prepared.manifestSha256, outputDirectory: join(f.root, 'output') };
  await assert.rejects(consumeProviderPlaceholder(args));
  rmSync(join(f.args.directory, EVIDENCE_MANIFEST));
  args.expectedSha256 = await recordEvidence(f.args.directory); await assert.rejects(consumeProviderPlaceholder(args));
});
test('other tags neither synthesize placeholders nor accept stray preparation and planned tag requires it', async () => {
  assert.equal(await prepareProviderPlaceholder({ tag: 'v3.2.0-rc.2' }), null);
  assert.deepEqual(await consumeProviderPlaceholder({ tag: 'v3.2.0' }), { providerPlaceholders: [], assets: [] });
  await assert.rejects(consumeProviderPlaceholder({ tag: 'v3.2.0', directory: '/unexpected' }));
  await assert.rejects(consumeProviderPlaceholder({ tag: PLACEHOLDER_HOST }));
});
test('even rehashed extra transfer members cannot enter the closed preparation artifact', async t => {
  const f = localPreparation(t); await prepareProviderPlaceholder(f.args);
  writeFileSync(join(f.args.directory, 'extra.json'), '{}'); rmSync(join(f.args.directory, EVIDENCE_MANIFEST));
  const expectedSha256 = await recordEvidence(f.args.directory);
  await assert.rejects(consumeProviderPlaceholder({ ...f.args, expectedSha256, outputDirectory: join(f.root, 'output') }), /unexpected placeholder transfer members/);
});
test('prepublication authentication rejects altered registry metadata and mismatched actual producer context', async t => {
  const f = localPreparation(t), original = f.args.fetchImpl;
  for (const kind of ['stub', 'time', 'source', 'attempt', 'status']) {
    const fetchImpl = async (url, options) => {
      const response = await original(url, options);
      if (url.endsWith('.tgz')) return response;
      const data = await response.json();
      if (url.includes('registry.npmjs.org')) {
        if (kind === 'stub') data.versions['0.0.0-stage'].stub = false;
        if (kind === 'time') data.time['0.0.0-stage'] = '2026-10-27T02:07:02.211Z';
      } else {
        if (kind === 'source') data.head_sha = '0'.repeat(40);
        if (kind === 'attempt') data.run_attempt++;
        if (kind === 'status') data.status = 'completed';
      }
      return new Response(JSON.stringify(data));
    };
    await assert.rejects(prepareProviderPlaceholder({ ...f.args, fetchImpl }), kind);
  }
});
