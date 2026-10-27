#!/usr/bin/env node
// One finite inventory repair, carried by the ordinary RC2 release. This does
// not make the failed RC1 workflow successful, qualified, or a soak baseline.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, run } from './release-set.mjs';
import { packageIdentitiesForVersion } from './release-package-inventory.mjs';
import { API, boundedResponse, releaseReader } from './release-burn-in-inputs.mjs';
import { bindAuditToRc, validateAuditEvidence } from './release-audit.mjs';
import { recordEvidence, verifyEvidence } from './release-evidence.mjs';

export const PUBLICATION_RECOVERY_CONTRACT = 'forma-publication-recovery-v1';
export const PUBLICATION_RECOVERY_MAX_BYTES = 8 * 1024 * 1024;
const HOST = 'v3.2.0-rc.2', ORIGINAL = 'v3.2.0-rc.1';
const WORKFLOW = '.github/workflows/release.yml';
const PREPARED = 'forma-publication-recovery-prepared-v1';
const PROOF = 'forma-publication-recovery-proof-v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalHash = value => sha(JSON.stringify(value));
const hash = value => assert.match(value ?? '', /^[a-f0-9]{64}$/, 'recovery requires SHA-256');
const oid = value => assert.match(value ?? '', /^[a-f0-9]{40}$/, 'recovery requires exact Git identity');
const number = value => assert(Number.isSafeInteger(value) && value > 0, 'recovery requires a positive integer');
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value ?? {}).sort(), [...keys].sort(), 'unexpected recovery fields');
const assetNames = plan => ({ receipt: `publication-recovery-${plan.original.tag}.json`, proof: `publication-recovery-${plan.original.tag}-proof.json` });
function timestamp(value) {
  assert.equal(typeof value, 'string');
  assert.equal(new Date(value).toISOString(), value, 'recovery requires an ISO timestamp');
}
function boundedJson(path, limit = PUBLICATION_RECOVERY_MAX_BYTES) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit, 'recovery metadata size/type differs');
  return JSON.parse(readFileSync(path));
}
function writeJson(path, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  assert(bytes.length <= PUBLICATION_RECOVERY_MAX_BYTES, 'recovery metadata exceeds bound');
  writeFileSync(path, bytes, { flag: 'wx' });
  return { sha256: sha(bytes), bytes: bytes.length };
}

export function validatePublicationRecoveryPlan(plan) {
  exactKeys(plan, ['contract', 'hostTag', 'original', 'jobs', 'artifacts', 'd14', 'packages']);
  assert.equal(plan.contract, 'forma-publication-recovery-plan-v1'); assert.equal(plan.hostTag, HOST);
  assert.deepEqual(plan.original, {
    tag: ORIGINAL, tagObject: 'b214f418d9334f05758a45c403f63166034097a6',
    commit: '6e5e2e4937e5ed9dc60e6669cb4887508ccdbdb8', runId: 40433276229, runAttempt: 1,
    workflow: WORKFLOW, event: 'push', conclusion: 'failure', recordJobId: 121967590802,
    failure: 'missing CHANGELOG entry for 3.2.0-rc.1',
  }, 'recovery is limited to the audited RC1 incident');
  assert(Array.isArray(plan.jobs) && plan.jobs.length === 11);
  assert.equal(new Set(plan.jobs.map(job => job.id)).size, 11);
  assert.equal(new Set(plan.jobs.map(job => job.name)).size, 11);
  for (const job of plan.jobs) {
    exactKeys(job, ['id', 'name', 'conclusion']); number(job.id);
    assert.equal(job.conclusion, job.id === plan.original.recordJobId ? 'failure' : 'success');
  }
  assert.equal(plan.jobs.find(job => job.id === plan.original.recordJobId)?.name, 'record');
  for (const name of ['check', 'pack', 'verify', 'publish-crates', 'publish-npm']) assert(plan.jobs.some(job => job.name === name));
  exactKeys(plan.artifacts, ['packed', 'p17']);
  for (const [key, artifact] of Object.entries(plan.artifacts)) {
    exactKeys(artifact, ['id', 'name', 'bytes', 'sha256', 'manifestSha256', ...(key === 'packed' ? ['setSha256'] : ['reportSha256', 'checks'])]);
    number(artifact.id); number(artifact.bytes); assert(artifact.bytes <= 64 * 1024 * 1024);
    assert.equal(artifact.name, key === 'packed' ? 'release-packed' : 'release-p17');
    hash(artifact.sha256); hash(artifact.manifestSha256); hash(key === 'packed' ? artifact.setSha256 : artifact.reportSha256);
  }
  assert.equal(plan.artifacts.p17.checks, 75);
  exactKeys(plan.d14, ['d14-report.json', 'd14-input-manifest.json', 'd14-review-evidence.json']);
  Object.values(plan.d14).forEach(hash);
  assert(Array.isArray(plan.packages));
  assert.deepEqual(plan.packages.map(p => `${p.registry}:${p.name}`).sort(), packageIdentitiesForVersion(ORIGINAL.slice(1)));
  for (const p of plan.packages) {
    exactKeys(p, ['registry', 'name', 'version', 'path', 'file', 'sha256', 'bytes', ...(p.registry === 'npm' ? ['integrity', 'shasum'] : [])]);
    assert.equal(p.version, ORIGINAL.slice(1)); hash(p.sha256); number(p.bytes); assert(p.bytes <= 8 * 1024 * 1024);
    const leaf = p.name.replace('@getforma/', '');
    assert.equal(p.path, `${p.registry === 'npm' ? 'packages' : 'crates'}/${leaf}`);
    assert.equal(p.file, `${p.registry === 'npm' ? 'getforma-' : ''}${leaf}-${p.version}.${p.registry === 'npm' ? 'tgz' : 'crate'}`);
    if (p.registry === 'npm') { assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/); assert.match(p.shasum, /^[a-f0-9]{40}$/); }
  }
  return plan;
}

export function recoveryPlanForTag(tag, root = ROOT) {
  if (tag !== HOST) return null;
  return validatePublicationRecoveryPlan(boundedJson(join(root, 'docs/release/publication-recovery-3.2-rc1.json')));
}
function context(value, { tag, commit, runId, job }) {
  exactKeys(value, ['tag', 'commit', 'runId', 'runAttempt', 'workflow', 'event', 'job']);
  assert.equal(value.tag, tag); assert.equal(value.commit, commit); assert.equal(value.runId, runId);
  oid(value.commit); number(value.runId); number(value.runAttempt);
  assert.equal(value.workflow, WORKFLOW); assert.equal(value.event, 'push'); assert.equal(value.job, job);
  assert.notEqual(value.commit, '6e5e2e4937e5ed9dc60e6669cb4887508ccdbdb8'); assert.notEqual(value.runId, 40433276229);
}
function makeContext({ tag, commit, runId, runAttempt }, job) {
  const value = { tag, commit, runId: Number(runId), runAttempt: Number(runAttempt), workflow: WORKFLOW, event: 'push', job };
  context(value, { tag: HOST, commit, runId: Number(runId), job }); return value;
}
function proofPointer(pointer, plan) {
  exactKeys(pointer, ['asset', 'sha256', 'bytes']);
  assert.equal(pointer.asset, assetNames(plan).proof); hash(pointer.sha256); number(pointer.bytes);
  assert(pointer.bytes <= PUBLICATION_RECOVERY_MAX_BYTES);
}
export function validatePublicationRecoveryReceipt(receipt, { hostTag, hostCommit, hostRunId, plan = recoveryPlanForTag(hostTag) }) {
  assert(plan, 'unplanned publication recovery'); validatePublicationRecoveryPlan(plan);
  assert.equal(hostTag, plan.hostTag);
  exactKeys(receipt, ['contract', 'disposition', 'performanceBaselineEligible', 'soakEligible', 'preparedBy', 'recordedBy', 'original', 'packages', 'proof', 'preparedManifestSha256', 'planSha256', 'preparedAt', 'recordedAt']);
  assert.equal(receipt.contract, PUBLICATION_RECOVERY_CONTRACT); assert.equal(receipt.disposition, 'inventory-only');
  assert.equal(receipt.performanceBaselineEligible, false); assert.equal(receipt.soakEligible, false);
  assert.deepEqual(receipt.original, plan.original); assert.deepEqual(receipt.packages, plan.packages);
  assert.equal(receipt.planSha256, canonicalHash(plan)); hash(receipt.preparedManifestSha256);
  for (const [key, job] of [['preparedBy', 'check'], ['recordedBy', 'record']]) context(receipt[key], { tag: hostTag, commit: hostCommit, runId: Number(hostRunId), job });
  assert(receipt.preparedBy.runAttempt <= receipt.recordedBy.runAttempt, 'recorder precedes preparation attempt');
  timestamp(receipt.preparedAt); timestamp(receipt.recordedAt); assert(receipt.preparedAt <= receipt.recordedAt);
  proofPointer(receipt.proof, plan);
  return receipt;
}

// Pure provider validators are also used after the prepared artifact transfer.
export function validateOriginalPublicationProvider({ latestRun, attempt, jobs, tagRef, annotatedTag, inventory, recordLog }, plan) {
  validatePublicationRecoveryPlan(plan); const original = plan.original;
  for (const value of [latestRun, attempt]) {
    assert.equal(value.repository?.full_name, 'getforma-dev/forma'); assert.equal(value.id, original.runId);
    assert.equal(value.run_attempt, original.runAttempt); assert.equal(value.head_sha, original.commit);
    assert.equal(value.head_branch, original.tag); assert.equal(value.path, WORKFLOW); assert.equal(value.event, 'push');
    assert.equal(value.status, 'completed'); assert.equal(value.conclusion, 'failure', 'original failure must remain visible');
  }
  assert.equal(tagRef.ref, `refs/tags/${original.tag}`); assert.equal(tagRef.object?.type, 'tag'); assert.equal(tagRef.object.sha, original.tagObject);
  assert.equal(annotatedTag.sha, original.tagObject); assert.equal(annotatedTag.tag, original.tag);
  assert.equal(annotatedTag.object?.type, 'commit'); assert.equal(annotatedTag.object.sha, original.commit);
  assert.equal(jobs.total_count, plan.jobs.length); assert.equal(jobs.jobs?.length, plan.jobs.length);
  assert.deepEqual(jobs.jobs.map(({ id, name, conclusion }) => ({ id, name, conclusion })).sort((a, b) => a.id - b.id), [...plan.jobs].sort((a, b) => a.id - b.id));
  for (const job of jobs.jobs) {
    assert.equal(job.run_id, original.runId); assert.equal(job.run_attempt, original.runAttempt);
    assert.equal(job.head_sha, original.commit); assert.equal(job.head_branch, original.tag); assert.equal(job.status, 'completed');
    const failures = job.steps.filter(step => step.conclusion === 'failure');
    if (job.name === 'record') assert.deepEqual(failures.map(step => step.name), ['Write DS12, the compatibility record and elapsed time']);
    else assert.deepEqual(failures, []);
  }
  assert(jobs.jobs.find(job => job.name === 'verify').steps.some(step => step.name === 'P17 packed corpus and both templates' && step.conclusion === 'success'));
  assert.equal(typeof recordLog, 'string');
  const failures = recordLog.split(/\r?\n/).filter(line => line.includes('release-record: '));
  assert.equal(failures.length, 1, 'record failure is missing or ambiguous');
  assert(failures[0].endsWith(`release-record: ${original.failure}`), 'record failed for another reason');
  assert(Number.isSafeInteger(inventory.total_count) && inventory.total_count > 0 && inventory.total_count <= 100);
  assert.equal(inventory.artifacts?.length, inventory.total_count);
  for (const artifact of Object.values(plan.artifacts)) {
    const matches = inventory.artifacts.filter(row => row.name === artifact.name); assert.equal(matches.length, 1, 'missing/duplicate original artifact');
    const row = matches[0]; assert.equal(row.id, artifact.id); assert.equal(row.expired, false);
    assert.equal(row.size_in_bytes, artifact.bytes); assert.equal(row.digest, `sha256:${artifact.sha256}`);
    assert.equal(row.workflow_run?.id, original.runId); assert.equal(row.workflow_run?.head_sha, original.commit); assert.equal(row.workflow_run?.head_branch, original.tag);
    assert.equal(row.archive_download_url, `${API}/actions/artifacts/${artifact.id}/zip`);
  }
}

export function originalRegistryArchiveUrl(item, metadata) {
  if (item.registry === 'npm') {
    assert.equal(metadata.name, item.name); assert.equal(metadata.version, item.version);
    assert.equal(metadata.dist?.integrity, item.integrity); assert.equal(metadata.dist?.shasum, item.shasum);
    const url = `https://registry.npmjs.org/${item.name}/-/${item.name.split('/')[1]}-${item.version}.tgz`;
    assert.equal(metadata.dist.tarball, url, 'registry archive URL differs'); return url;
  }
  assert.equal(item.registry, 'crates');
  assert.equal(metadata.version?.crate, item.name); assert.equal(metadata.version.num, item.version);
  assert.equal(metadata.version.checksum, item.sha256); assert.equal(metadata.version.yanked, false);
  return `https://static.crates.io/crates/${item.name}/${item.name}-${item.version}.crate`;
}
export function verifyOriginalRegistryBytes(item, bytes) {
  assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256, `${item.name}: registry bytes differ from original DS11`);
  if (item.registry === 'npm') {
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, item.integrity);
    assert.equal(createHash('sha1').update(bytes).digest('hex'), item.shasum);
  }
}

export async function authenticateOriginalPublication({ plan = recoveryPlanForTag(HOST), root = ROOT, fetchImpl = fetch, token = process.env.GH_TOKEN } = {}) {
  validatePublicationRecoveryPlan(plan);
  const deadline = AbortSignal.timeout(210_000);
  const request = (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.any([deadline, ...(options.signal ? [options.signal] : [])]) });
  const get = releaseReader({ fetchImpl: request, token }), original = plan.original;
  // Job logs, like Actions ZIPs, redirect through GitHub's JSON API. The
  // release-asset octet-stream Accept header is rejected by this endpoint.
  const log = async () => boundedResponse(await request(`${API}/actions/jobs/${original.recordJobId}/logs`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'getforma-publication-recovery', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(60_000),
  }), 1024 * 1024);
  const [latestRun, attempt, jobs, tagRef, annotatedTag, inventory, logBytes] = await Promise.all([
    get(`${API}/actions/runs/${original.runId}`), get(`${API}/actions/runs/${original.runId}/attempts/${original.runAttempt}`),
    get(`${API}/actions/runs/${original.runId}/attempts/${original.runAttempt}/jobs?per_page=100`),
    get(`${API}/git/ref/tags/${original.tag}`), get(`${API}/git/tags/${original.tagObject}`),
    get(`${API}/actions/runs/${original.runId}/artifacts?per_page=100`),
    log(),
  ]);
  const provider = { latestRun, attempt, jobs, tagRef, annotatedTag, inventory, recordLog: logBytes.toString('utf8') };
  validateOriginalPublicationProvider(provider, plan);
  assert.equal(run('git', ['rev-parse', `${original.tag}^{tag}`], root).trim(), original.tagObject);
  assert.equal(run('git', ['rev-parse', `${original.tag}^{commit}`], root).trim(), original.commit);
  const temporary = mkdtempSync(join(tmpdir(), 'forma-publication-recovery-'));
  try {
    const download = async ([name, expected]) => {
      const file = join(temporary, `${name}.zip`);
      const downloaded = await get(`${API}/actions/artifacts/${expected.id}/zip`, { binary: true, destination: file, limit: expected.bytes });
      assert.deepEqual(downloaded, { bytes: expected.bytes, sha256: expected.sha256 });
      const files = join(temporary, name);
      run('python3', [join(root, 'scripts/release-unpack.py'), 'zip', file, files, String(name === 'p17' ? 256 * 1024 * 1024 : 16 * 1024 * 1024)], root, { timeout: 30_000 });
      return [name, files];
    };
    // Finish both owned downloads before deleting their common temporary tree.
    const downloads = await Promise.allSettled(Object.entries(plan.artifacts).map(download));
    for (const result of downloads) if (result.status === 'rejected') throw result.reason;
    const files = Object.fromEntries(downloads.map(result => result.value));
    run('bash', [join(root, 'scripts/release-artifacts.sh'), 'verify', files.packed, plan.artifacts.packed.manifestSha256], root, { timeout: 30_000 });
    const ds11Text = readFileSync(join(files.packed, 'release-set.json'), 'utf8'); assert.equal(sha(ds11Text), plan.artifacts.packed.setSha256);
    const ds11 = JSON.parse(ds11Text);
    assert.equal(ds11.schema, 1); assert.equal(ds11.dryRun, false); assert.equal(ds11.tag, original.tag); assert.equal(ds11.commit, original.commit); assert.equal(String(ds11.run), String(original.runId));
    const ds11Packages = plan.packages.map(({ bytes, integrity, shasum, ...item }) => item);
    assert.deepEqual(ds11.packages, ds11Packages);
    for (const item of plan.packages) {
      const bytes = readFileSync(join(files.packed, item.file)); assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256);
      if (item.registry === 'npm') { assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, item.integrity); assert.equal(createHash('sha1').update(bytes).digest('hex'), item.shasum); }
    }
    const p17Manifest = await verifyEvidence(files.p17, plan.artifacts.p17.manifestSha256);
    const p17Bytes = readFileSync(join(files.p17, 'p17.json')); assert.equal(sha(p17Bytes), plan.artifacts.p17.reportSha256);
    const p17 = JSON.parse(p17Bytes);
    assert.equal(p17.commit, original.commit); assert.equal(p17.passed, true); assert.equal(p17.tests?.length, plan.artifacts.p17.checks);
    assert(p17.tests.every(test => test.passed === true)); assert(p17.elapsedSeconds > 0 && p17.elapsedSeconds <= 1800);
    const d14 = {};
    for (const [name, expected] of Object.entries(plan.d14)) {
      const content = run('git', ['show', `${original.commit}:docs/release/${name}`], root);
      assert.equal(sha(content), expected); d14[name] = content;
    }
    const binding = bindAuditToRc({ rcCommit: original.commit, reportBytes: d14['d14-report.json'], inputBytes: d14['d14-input-manifest.json'], root });
    binding.reviewEvidenceSha256 = validateAuditEvidence(JSON.parse(d14['d14-report.json']), Buffer.from(d14['d14-review-evidence.json']));
    const registry = await Promise.all(plan.packages.map(async item => {
      const metadataUrl = item.registry === 'npm' ? `https://registry.npmjs.org/${encodeURIComponent(item.name)}/${item.version}` : `https://crates.io/api/v1/crates/${item.name}/${item.version}`;
      const metadataBytes = await boundedResponse(await request(metadataUrl, { headers: { 'User-Agent': 'getforma-publication-recovery' }, signal: AbortSignal.timeout(60_000) }), 1024 * 1024);
      const metadata = JSON.parse(metadataBytes);
      const archiveUrl = originalRegistryArchiveUrl(item, metadata);
      const bytes = await boundedResponse(await request(archiveUrl, { signal: AbortSignal.timeout(60_000) }), item.bytes);
      verifyOriginalRegistryBytes(item, bytes);
      return { ...item, metadataUrl, archiveUrl, metadata };
    }));
    deadline.throwIfAborted();
    const proof = {
      contract: PROOF, disposition: 'inventory-only', original, planSha256: canonicalHash(plan), provider,
      ds11: { content: ds11Text, sha256sums: readFileSync(join(files.packed, 'SHA256SUMS'), 'utf8') },
      p17: { ...plan.artifacts.p17, filesVerified: p17Manifest.files, passed: p17.passed, checks: p17.tests.length, elapsedSeconds: p17.elapsedSeconds,
        rawEvidenceAttached: false, retention: 'Original release-p17 Actions artifact; verified in full during preparation, not copied into this inventory receipt or promoted to qualification.' },
      d14: { files: d14, binding, scope: 'Original accepted D14 source evidence only; the original release record failure remains unresolved for that immutable tag.' },
      registry,
    };
    validatePublicationRecoveryProof(proof, plan); return proof;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function validatePublicationRecoveryProof(proof, plan) {
  exactKeys(proof, ['contract', 'disposition', 'original', 'planSha256', 'provider', 'ds11', 'p17', 'd14', 'registry']);
  assert.equal(proof.contract, PROOF); assert.equal(proof.disposition, 'inventory-only');
  assert.deepEqual(proof.original, plan.original); assert.equal(proof.planSha256, canonicalHash(plan));
  validateOriginalPublicationProvider(proof.provider, plan);
  assert.equal(sha(proof.ds11.content), plan.artifacts.packed.setSha256); assert.equal(sha(proof.ds11.sha256sums), plan.artifacts.packed.manifestSha256);
  for (const [key, value] of Object.entries(plan.artifacts.p17)) assert.equal(proof.p17[key], value);
  assert.equal(proof.p17.rawEvidenceAttached, false); assert.equal(proof.p17.passed, true); number(proof.p17.filesVerified);
  assert(proof.p17.elapsedSeconds > 0 && proof.p17.elapsedSeconds <= 1800);
  for (const [name, expected] of Object.entries(plan.d14)) assert.equal(sha(proof.d14.files[name]), expected);
  assert.deepEqual(proof.registry.map(({ metadataUrl, archiveUrl, metadata, ...item }) => item), plan.packages);
  for (const item of proof.registry) assert.equal(item.archiveUrl, originalRegistryArchiveUrl(item, item.metadata));
  return proof;
}

export async function preparePublicationRecovery({ tag, commit, runId, runAttempt, directory, root = ROOT, fetchImpl = fetch, token = process.env.GH_TOKEN }) {
  const plan = recoveryPlanForTag(tag, root); if (!plan) return null;
  const preparedBy = makeContext({ tag, commit, runId, runAttempt }, 'check');
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit, 'preparation checkout differs');
  assert.equal(run('git', ['rev-parse', `${tag}^{commit}`], root).trim(), commit, 'preparation tag differs');
  const get = releaseReader({ fetchImpl, token });
  const actual = await get(`${API}/actions/runs/${preparedBy.runId}/attempts/${preparedBy.runAttempt}`);
  assert.equal(actual.repository?.full_name, 'getforma-dev/forma'); assert.equal(actual.id, preparedBy.runId); assert.equal(actual.run_attempt, preparedBy.runAttempt);
  assert.equal(actual.head_sha, commit); assert.equal(actual.head_branch, tag); assert.equal(actual.path, WORKFLOW); assert.equal(actual.event, 'push');
  assert.equal(actual.status, 'in_progress', 'preparation requires the current actual release run');
  const proof = await authenticateOriginalPublication({ plan, root, fetchImpl, token });
  validatePublicationRecoveryProof(proof, plan);
  mkdirSync(directory);
  const proofIdentity = writeJson(join(directory, 'proof.json'), proof);
  const preparedAt = new Date().toISOString();
  writeJson(join(directory, 'prepared.json'), { contract: PREPARED, planSha256: canonicalHash(plan), preparedBy, preparedAt, proof: { asset: assetNames(plan).proof, ...proofIdentity } });
  const manifestSha256 = await recordEvidence(directory);
  return { manifestSha256, preparedBy, preparedAt };
}

export async function consumePublicationRecovery({ tag, commit, runId, runAttempt, directory, expectedSha256, outputDirectory, root = ROOT }) {
  const plan = recoveryPlanForTag(tag, root);
  if (!plan) { assert(!directory && !expectedSha256, 'unplanned recovery artifact'); return { publicationRecoveries: [], assets: [] }; }
  assert(directory && outputDirectory, 'planned recovery artifact is required'); hash(expectedSha256);
  const source = resolve(directory), output = resolve(outputDirectory);
  assert(source !== output && !output.startsWith(source + sep), 'final receipt must be outside the prepared artifact');
  await verifyEvidence(directory, expectedSha256);
  const prepared = boundedJson(join(directory, 'prepared.json'));
  exactKeys(prepared, ['contract', 'planSha256', 'preparedBy', 'preparedAt', 'proof']);
  assert.equal(prepared.contract, PREPARED); assert.equal(prepared.planSha256, canonicalHash(plan));
  proofPointer(prepared.proof, plan);
  const proof = boundedJson(join(directory, 'proof.json'));
  const proofBytes = readFileSync(join(directory, 'proof.json'));
  assert.equal(proofBytes.length, prepared.proof.bytes); assert.equal(sha(proofBytes), prepared.proof.sha256);
  validatePublicationRecoveryProof(proof, plan);
  const receipt = {
    contract: PUBLICATION_RECOVERY_CONTRACT, disposition: 'inventory-only', performanceBaselineEligible: false, soakEligible: false,
    preparedBy: prepared.preparedBy, recordedBy: makeContext({ tag, commit, runId, runAttempt }, 'record'),
    original: plan.original, packages: plan.packages, proof: prepared.proof,
    preparedManifestSha256: expectedSha256, planSha256: canonicalHash(plan), preparedAt: prepared.preparedAt, recordedAt: new Date().toISOString(),
  };
  validatePublicationRecoveryReceipt(receipt, { hostTag: tag, hostCommit: commit, hostRunId: runId, plan });
  mkdirSync(output, { recursive: true }); const names = assetNames(plan);
  const proofPath = join(output, names.proof); writeFileSync(proofPath, proofBytes, { flag: 'wx' });
  const receiptPath = join(output, names.receipt), identity = writeJson(receiptPath, receipt);
  return { publicationRecoveries: [{ contract: PUBLICATION_RECOVERY_CONTRACT, originalTag: plan.original.tag, asset: names.receipt, ...identity, proof: prepared.proof }], assets: [receiptPath, proofPath] };
}

async function main() {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], 'prepare');
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.GITHUB_REPOSITORY, 'getforma-dev/forma');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push'); assert.equal(process.env.GITHUB_REF_TYPE, 'tag'); assert.equal(process.env.GITHUB_JOB, 'check');
  const result = await preparePublicationRecovery({ tag: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, directory: process.argv[3] });
  assert(process.env.GITHUB_OUTPUT); appendFileSync(process.env.GITHUB_OUTPUT, `manifest-sha256=${result?.manifestSha256 ?? ''}\n`);
  console.log(result ? 'Original RC1 publication authenticated for an inventory-only RC2 receipt.' : 'No publication recovery is planned for this tag.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(`release-publication-recovery: ${error.message}`); process.exitCode = 1; });
