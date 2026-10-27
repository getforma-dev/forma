import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordEvidence } from './release-evidence.mjs';
import { API } from './release-burn-in-inputs.mjs';
import {
  PUBLICATION_RECOVERY_CONTRACT, PUBLICATION_RECOVERY_MAX_BYTES,
  recoveryPlanForTag, validatePublicationRecoveryPlan, validatePublicationRecoveryReceipt,
  validateOriginalPublicationProvider, authenticateOriginalPublication,
  originalRegistryArchiveUrl, verifyOriginalRegistryBytes,
  preparePublicationRecovery, consumePublicationRecovery,
} from './release-publication-recovery.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hostCommit = 'a'.repeat(40), hostRunId = 50000000001;
const host = { tag: 'v3.2.0-rc.2', commit: hostCommit, runId: hostRunId, runAttempt: 1 };
const options = { hostTag: host.tag, hostCommit, hostRunId };
const ctx = job => ({ ...host, workflow: '.github/workflows/release.yml', event: 'push', job });
const names = { receipt: 'publication-recovery-v3.2.0-rc.1.json', proof: 'publication-recovery-v3.2.0-rc.1-proof.json' };
const registryMetadata = item => item.registry === 'npm'
  ? { name: item.name, version: item.version, dist: { integrity: item.integrity, shasum: item.shasum,
    tarball: `https://registry.npmjs.org/${item.name}/-/${item.name.split('/')[1]}-${item.version}.tgz` } }
  : { version: { crate: item.name, num: item.version, checksum: item.sha256, yanked: false } };

// The run/job/tag/artifact identities below come from the actual RC1 provider
// receipts, including its failed record step. Offline responses and tiny byte
// fixtures below are test inputs, never release qualification or recovery proof.
function provider(plan = recoveryPlanForTag(host.tag)) {
  const o = plan.original;
  const actualRun = { repository: { full_name: 'getforma-dev/forma' }, id: 40433276229, run_attempt: 1,
    head_sha: '6e5e2e4937e5ed9dc60e6669cb4887508ccdbdb8', head_branch: 'v3.2.0-rc.1',
    path: '.github/workflows/release.yml', event: 'push', status: 'completed', conclusion: 'failure' };
  return {
    latestRun: structuredClone(actualRun), attempt: structuredClone(actualRun),
    jobs: { total_count: 11, jobs: plan.jobs.map(job => ({ ...job, run_id: 40433276229, run_attempt: 1,
      head_sha: actualRun.head_sha, head_branch: actualRun.head_branch, status: 'completed',
      steps: job.name === 'verify' ? [{ name: 'P17 packed corpus and both templates', conclusion: 'success' }]
        : job.name === 'record' ? [{ name: 'Write DS12, the compatibility record and elapsed time', conclusion: 'failure' }] : [],
    })) },
    tagRef: { ref: 'refs/tags/v3.2.0-rc.1', object: { type: 'tag', sha: 'b214f418d9334f05758a45c403f63166034097a6' } },
    annotatedTag: { tag: 'v3.2.0-rc.1', sha: 'b214f418d9334f05758a45c403f63166034097a6', object: { type: 'commit', sha: actualRun.head_sha } },
    inventory: { total_count: 2, artifacts: Object.values(plan.artifacts).map(a => ({ id: a.id, name: a.name,
      size_in_bytes: a.bytes, digest: `sha256:${a.sha256}`, expired: false,
      workflow_run: { id: o.runId, head_sha: o.commit, head_branch: o.tag }, archive_download_url: `${API}/actions/artifacts/${a.id}/zip` })) },
    recordLog: '2026-10-27T02:01:35.6801684Z release-record: missing CHANGELOG entry for 3.2.0-rc.1\n',
  };
}
function receipt(plan = recoveryPlanForTag(host.tag)) {
  return { contract: PUBLICATION_RECOVERY_CONTRACT, disposition: 'inventory-only', performanceBaselineEligible: false, soakEligible: false,
    preparedBy: ctx('check'), recordedBy: ctx('record'), original: plan.original, packages: plan.packages,
    proof: { asset: names.proof, sha256: 'b'.repeat(64), bytes: 123 }, preparedManifestSha256: 'c'.repeat(64),
    planSha256: sha(JSON.stringify(plan)), preparedAt: '2026-10-27T04:00:00.000Z', recordedAt: '2026-10-27T04:01:00.000Z' };
}
async function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'forma-recovery-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'source'), directory = join(parent, 'prepared'), outputDirectory = join(parent, 'record');
  mkdirSync(join(root, 'docs/release'), { recursive: true }); mkdirSync(directory);
  const plan = recoveryPlanForTag(host.tag);
  const ds11 = { content: '{"fixture":"synthetic DS11; not qualification"}\n', sha256sums: 'offline synthetic checksum bytes\n' };
  plan.artifacts.packed.setSha256 = sha(ds11.content); plan.artifacts.packed.manifestSha256 = sha(ds11.sha256sums);
  const d14 = { files: Object.fromEntries(Object.keys(plan.d14).map(name => [name, `${name}: synthetic test input\n`])), binding: {}, scope: 'offline test only' };
  for (const [name, content] of Object.entries(d14.files)) plan.d14[name] = sha(content);
  writeFileSync(join(root, 'docs/release/publication-recovery-3.2-rc1.json'), JSON.stringify(plan));
  const proof = { contract: 'forma-publication-recovery-proof-v1', disposition: 'inventory-only', original: plan.original,
    planSha256: sha(JSON.stringify(plan)), provider: provider(plan), ds11,
    p17: { ...plan.artifacts.p17, filesVerified: 1, passed: true, elapsedSeconds: 1247.311, rawEvidenceAttached: false },
    d14, registry: plan.packages.map(item => { const metadata = registryMetadata(item);
      return { ...item, metadataUrl: 'offline fixture', archiveUrl: originalRegistryArchiveUrl(item, metadata), metadata }; }) };
  const bytes = Buffer.from(JSON.stringify(proof)); writeFileSync(join(directory, 'proof.json'), bytes);
  const prepared = { contract: 'forma-publication-recovery-prepared-v1', planSha256: sha(JSON.stringify(plan)),
    preparedBy: ctx('check'), preparedAt: '2026-10-27T04:00:00.000Z', proof: { asset: names.proof, sha256: sha(bytes), bytes: bytes.length } };
  // Avoid tying unit tests to the day on which the real release happens.
  prepared.preparedAt = '2020-01-01T00:00:00.000Z';
  writeFileSync(join(directory, 'prepared.json'), JSON.stringify(prepared));
  const expectedSha256 = await recordEvidence(directory);
  return { parent, root, directory, outputDirectory, plan, proof, prepared, expectedSha256 };
}

test('finite audited plan identifies eight original archives and only RC2 hosts recovery', () => {
  const plan = recoveryPlanForTag(host.tag);
  assert.equal(plan.packages.length, 8); assert.equal(plan.original.conclusion, 'failure');
  assert.equal(plan.artifacts.p17.bytes, 61070474); assert.equal(plan.artifacts.p17.checks, 75);
  for (const tag of ['v3.2.0-rc.1', 'v3.2.0-rc.3', 'v3.2.0', 'v3.1.0', 'metadata-recovery']) assert.equal(recoveryPlanForTag(tag), null);
  for (const mutate of [p => p.packages.pop(), p => p.packages.push(p.packages[0]), p => p.original.commit = hostCommit,
    p => p.original.conclusion = 'success', p => p.hostTag = 'v3.2.0-rc.3', p => p.packages[0].version = '3.2.0-rc.2']) {
    const bad = structuredClone(plan); mutate(bad); assert.throws(() => validatePublicationRecoveryPlan(bad));
  }
});

test('receipt distinguishes original failure, actual recorder, and inventory-only eligibility', () => {
  const value = receipt(); assert.equal(validatePublicationRecoveryReceipt(value, options), value);
  value.recordedBy.runAttempt = 2;
  assert.equal(validatePublicationRecoveryReceipt(value, { ...options, hostRunId: String(hostRunId) }), value);
});

for (const [name, mutate] of [
  ['original success claim', r => r.original.conclusion = 'success'],
  ['new qualification field', r => r.qualified = true], ['baseline promotion', r => r.performanceBaselineEligible = true],
  ['soak promotion', r => r.soakEligible = true], ['partial package set', r => r.packages.pop()],
  ['duplicate package', r => r.packages[1] = r.packages[0]], ['wrong package archive', r => r.packages[0].sha256 = 'f'.repeat(64)],
  ['original run as recorder', r => r.recordedBy.runId = r.original.runId], ['different recorder run', r => r.recordedBy.runId++],
  ['recorder before producer', r => r.preparedBy.runAttempt = 3], ['different host tag', r => r.preparedBy.tag = 'v3.2.0-rc.3'],
  ['different host commit', r => r.recordedBy.commit = 'f'.repeat(40)], ['fake recorder job', r => r.recordedBy.job = 'check'],
  ['different workflow', r => r.preparedBy.workflow = 'recovery.yml'], ['wrong plan', r => r.planSha256 = 'f'.repeat(64)],
  ['proof path traversal', r => r.proof.asset = '../proof.json'], ['oversized proof', r => r.proof.bytes = PUBLICATION_RECOVERY_MAX_BYTES + 1],
  ['fractional run', r => r.recordedBy.runId = 1.5], ['record before preparation', r => r.recordedAt = '2020-01-01T00:00:00.000Z'],
]) test(`receipt refuses ${name}`, () => {
  const value = receipt(); mutate(value); assert.throws(() => validatePublicationRecoveryReceipt(value, options));
});

test('actual failed provider tuple is accepted only with the sole exact record failure', () => {
  assert.doesNotThrow(() => validateOriginalPublicationProvider(provider(), recoveryPlanForTag(host.tag)));
});
for (const [name, mutate] of [
  ['changed latest outcome', p => p.latestRun.conclusion = 'success'], ['later original run attempt', p => p.latestRun.run_attempt++],
  ['fork repository', p => p.attempt.repository.full_name = 'other/forma'], ['wrong source commit', p => p.attempt.head_sha = hostCommit],
  ['retagged object', p => p.tagRef.object.sha = hostCommit], ['changed peeled commit', p => p.annotatedTag.object.sha = hostCommit],
  ['lightweight replacement tag', p => p.tagRef.object.type = 'commit'], ['missing job', p => p.jobs.jobs.pop()],
  ['duplicated job', p => p.jobs.jobs[1] = p.jobs.jobs[0]], ['second failed job', p => p.jobs.jobs[0].conclusion = 'failure'],
  ['failed P17 step', p => p.jobs.jobs.find(j => j.name === 'verify').steps[0].conclusion = 'failure'],
  ['other failed record step', p => p.jobs.jobs.find(j => j.name === 'record').steps[0].name = 'Other error'],
  ['unknown log cause', p => p.recordLog = 'release-record: network failed'], ['expired artifact', p => p.inventory.artifacts[0].expired = true],
  ['additional record failure', p => p.recordLog += 'release-record: network failed\n'],
  ['other artifact provider digest', p => p.inventory.artifacts[0].digest = `sha256:${'f'.repeat(64)}`],
  ['other artifact length', p => p.inventory.artifacts[0].size_in_bytes++], ['other artifact source', p => p.inventory.artifacts[0].workflow_run.head_sha = hostCommit],
  ['missing artifact', p => { p.inventory.artifacts.pop(); p.inventory.total_count--; }],
  ['duplicate artifact', p => { p.inventory.artifacts.push(p.inventory.artifacts[0]); p.inventory.total_count++; }],
  ['truncated provider inventory', p => p.inventory.total_count++], ['untrusted artifact URL', p => p.inventory.artifacts[0].archive_download_url = 'https://example.com/archive'],
]) test(`original provider refuses ${name}`, () => {
  const value = provider(); mutate(value); assert.throws(() => validateOriginalPublicationProvider(value, recoveryPlanForTag(host.tag)));
});

test('original provider HTTP failure is never treated as absent publication or successful evidence', async () => {
  const calls = [];
  await assert.rejects(authenticateOriginalPublication({ token: undefined, fetchImpl: async url => {
    calls.push(url); return new Response('missing', { status: 404 });
  } }), /unreadable/);
  assert(calls.length > 0); assert(calls.every(url => url.startsWith(`${API}/`)));
});

test('job logs use the JSON redirect API media type, not release-asset octet-stream', async () => {
  let logHeaders;
  await assert.rejects(authenticateOriginalPublication({ token: 'test-token-not-a-credential', fetchImpl: async (url, options) => {
    if (url.endsWith('/logs')) logHeaders = options.headers;
    return new Response('offline refusal', { status: 404 });
  } }));
  assert.equal(logHeaders.Accept, 'application/vnd.github+json');
  assert.equal(logHeaders.Authorization, 'Bearer test-token-not-a-credential');
});

test('each original registry identity refuses wrong metadata, unsafe archives, yanks, and changed bytes', () => {
  for (const original of recoveryPlanForTag(host.tag).packages) {
    const item = structuredClone(original), bytes = Buffer.from(`offline test archive ${item.name}`);
    item.bytes = bytes.length; item.sha256 = sha(bytes);
    if (item.registry === 'npm') { item.integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`; item.shasum = createHash('sha1').update(bytes).digest('hex'); }
    const metadata = registryMetadata(item);
    assert.match(originalRegistryArchiveUrl(item, metadata), /^https:\/\/(registry\.npmjs\.org|static\.crates\.io)\//);
    assert.doesNotThrow(() => verifyOriginalRegistryBytes(item, bytes));
    const altered = Buffer.from(bytes); altered[0] ^= 1;
    assert.throws(() => verifyOriginalRegistryBytes(item, altered), /registry bytes differ/);
    assert.throws(() => verifyOriginalRegistryBytes(item, bytes.subarray(1)));
    if (item.registry === 'npm') {
      for (const mutate of [m => m.name = '@getforma/other', m => m.version = '3.2.0-rc.2',
        m => m.dist.integrity = 'sha512-other', m => m.dist.shasum = 'f'.repeat(40), m => m.dist.tarball = 'https://example.com/untrusted.tgz']) {
        const bad = structuredClone(metadata); mutate(bad); assert.throws(() => originalRegistryArchiveUrl(item, bad));
      }
      const differentIntegrity = { ...item, integrity: 'sha512-other' }; assert.throws(() => verifyOriginalRegistryBytes(differentIntegrity, bytes));
    } else {
      for (const mutate of [m => m.version.crate = 'other', m => m.version.num = '3.2.0-rc.2',
        m => m.version.checksum = 'f'.repeat(64), m => m.version.yanked = true]) {
        const bad = structuredClone(metadata); mutate(bad); assert.throws(() => originalRegistryArchiveUrl(item, bad));
      }
    }
  }
});

test('unplanned tags do not fetch or prepare, but cannot consume an unexpected artifact', async () => {
  assert.equal(await preparePublicationRecovery({ tag: 'v3.2.0-rc.3', fetchImpl: () => { throw Error('unexpected fetch'); } }), null);
  assert.deepEqual(await consumePublicationRecovery({ tag: 'v3.2.0-rc.3' }), { publicationRecoveries: [], assets: [] });
  await assert.rejects(consumePublicationRecovery({ tag: 'v3.2.0-rc.3', expectedSha256: 'a'.repeat(64) }), /unplanned/);
  await assert.rejects(consumePublicationRecovery({ ...host }), /required/);
});

test('consume preserves authenticated preparation and emits separate receipt for a record-only retry', async t => {
  const f = await fixture(t), before = readFileSync(join(f.directory, 'EVIDENCE-SHA256.json'));
  const result = await consumePublicationRecovery({ ...host, ...f, runAttempt: 2 });
  assert.equal(result.assets.length, 2); const pointer = result.publicationRecoveries[0];
  const bytes = readFileSync(result.assets[0]), value = JSON.parse(bytes);
  validatePublicationRecoveryReceipt(value, { ...options, plan: f.plan });
  assert.equal(value.preparedBy.runAttempt, 1); assert.equal(value.recordedBy.runAttempt, 2);
  assert.equal(pointer.sha256, sha(bytes)); assert.equal(pointer.bytes, bytes.length);
  assert.equal(pointer.proof.sha256, sha(readFileSync(result.assets[1])));
  assert.deepEqual(readFileSync(join(f.directory, 'EVIDENCE-SHA256.json')), before);
  assert.equal(value.original.conclusion, 'failure'); assert.equal(value.soakEligible, false);
});

for (const [name, mutate] of [
  ['proof byte change', f => writeFileSync(join(f.directory, 'proof.json'), '{}')],
  ['prepared identity change', f => writeFileSync(join(f.directory, 'prepared.json'), '{}')],
  ['missing proof', f => rmSync(join(f.directory, 'proof.json'))],
  ['extra file', f => writeFileSync(join(f.directory, 'extra.json'), '{}')],
]) test(`consume refuses transferred ${name}`, async t => {
  const f = await fixture(t); mutate(f); await assert.rejects(consumePublicationRecovery({ ...host, ...f }));
});

test('authenticated preparation still refuses wrong source, future producer, or overlapping output', async t => {
  const f = await fixture(t);
  await assert.rejects(consumePublicationRecovery({ ...host, ...f, commit: 'd'.repeat(40) }));
  await assert.rejects(consumePublicationRecovery({ ...host, ...f, runId: hostRunId + 1 }));
  await assert.rejects(consumePublicationRecovery({ ...host, ...f, runAttempt: 0 }));
  await assert.rejects(consumePublicationRecovery({ ...host, ...f, outputDirectory: join(f.directory, 'record') }), /outside/);
});

test('even re-recorded preparation cannot promote the failed original source', async t => {
  const f = await fixture(t);
  f.proof.provider.latestRun.conclusion = 'success';
  const bytes = Buffer.from(JSON.stringify(f.proof)); writeFileSync(join(f.directory, 'proof.json'), bytes);
  f.prepared.proof.sha256 = sha(bytes); f.prepared.proof.bytes = bytes.length;
  writeFileSync(join(f.directory, 'prepared.json'), JSON.stringify(f.prepared));
  rmSync(join(f.directory, 'EVIDENCE-SHA256.json'));
  const expectedSha256 = await recordEvidence(f.directory);
  await assert.rejects(consumePublicationRecovery({ ...host, ...f, expectedSha256 }), /failure must remain/);
});
