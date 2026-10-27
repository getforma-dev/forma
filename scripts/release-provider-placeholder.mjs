#!/usr/bin/env node
// One provider-created holding version, accounted for by the prospective RC3
// DS12. It is never an ordinary package release or qualification baseline.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, run } from './release-set.mjs';
import { API, boundedResponse, releaseReader, verifyRun } from './release-burn-in-inputs.mjs';
import { EVIDENCE_MANIFEST, recordEvidence, verifyEvidence } from './release-evidence.mjs';

export const PLACEHOLDER_CONTRACT = 'forma-npm-provider-placeholder-v1';
export const PLACEHOLDER_HOST = 'v3.2.0-rc.3';
export const PLACEHOLDER_ASSET = 'npm-provider-placeholder-router-0.0.0-stage.json';
export const PLACEHOLDER_PLAN_PATH = 'docs/release/npm-provider-placeholder-router.json';
export const PLACEHOLDER_MAX_BYTES = 64 * 1024;
const WORKFLOW = '.github/workflows/release.yml';
const METADATA_URL = 'https://registry.npmjs.org/%40getforma%2Frouter';
const PREPARED = 'forma-npm-provider-placeholder-prepared-v1';
const PREPARE_STEP = 'Authenticate the finite provider placeholder before publishing';
const UPLOAD_STEP = 'Retain authenticated provider placeholder';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => { assert(value && typeof value === 'object' && !Array.isArray(value), 'placeholder object required'); assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'unexpected placeholder fields'); };
const positive = value => assert(Number.isSafeInteger(value) && value > 0, 'positive placeholder identity required');
const hash = value => assert.match(value ?? '', /^[a-f0-9]{64}$/, 'placeholder SHA256 required');
function timestamp(value) { assert.equal(typeof value, 'string'); assert.equal(new Date(value).toISOString(), value); }
function bytesAt(path) {
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= PLACEHOLDER_MAX_BYTES, 'placeholder file bound/type differs');
  return readFileSync(path);
}
function writeJson(path, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert(bytes.length <= PLACEHOLDER_MAX_BYTES);
  writeFileSync(path, bytes, { flag: 'wx' }); return { bytes: bytes.length, sha256: sha(bytes) };
}

export function validatePlaceholderPlan(plan) {
  exact(plan, ['contract', 'hostTag', 'registry', 'name', 'version', 'disposition', 'qualificationEligible', 'supportEligible', 'performanceBaselineEligible', 'soakEligible', 'metadata', 'archive', 'members', 'evidence']);
  assert.equal(plan.contract, 'forma-npm-provider-placeholder-plan-v1'); assert.equal(plan.hostTag, PLACEHOLDER_HOST);
  assert.equal(plan.registry, 'npm'); assert.equal(plan.name, '@getforma/router'); assert.equal(plan.version, '0.0.0-stage');
  assert.equal(plan.disposition, 'provider-placeholder-inventory-only');
  for (const key of ['qualificationEligible', 'supportEligible', 'performanceBaselineEligible', 'soakEligible']) assert.equal(plan[key], false);
  assert.deepEqual(plan.metadata, { name: plan.name, version: plan.version, _id: `${plan.name}@${plan.version}`, stub: true,
    description: 'Temporary package placeholder for staged publishing', publishedAt: '2026-10-27T02:07:01.211Z', fileCount: 2, unpackedSize: 338 });
  assert.deepEqual(plan.archive, { url: 'https://registry.npmjs.org/@getforma/router/-/router-0.0.0-stage.tgz', bytes: 364,
    sha256: '846480ebca8b85660824c70ef4a64ffdd3b6af2aed8776941392ba64ea9a7954', sha1: '026a9400cb2aae640064febda3e80aaea9d21dfc',
    integrity: 'sha512-Bysk+NLfMw1wR5CyyjlkAgKUIX+f/RNVvChbchRoin0nuebDoim8rdZdJDdlGm42CNmnu6inYAL/TDNsBjgzSA==' });
  assert.deepEqual(plan.members, [
    { name: 'package/package.json', bytes: 148, sha256: '195a4c108c79e8a9eee25f32dd601c3e4db43c0ecccc23753664ee567fef1f3d' },
    { name: 'package/README.md', bytes: 190, sha256: 'e9a4a2e10e03f9e46ab3c2e5020b354b3ab20cc2c89381ce91f5b2a756e6b122' },
  ]);
  exact(plan.evidence, ['providerDocumentation', 'observedDuring', 'registryObservationSha256', 'archiveAuthenticationSha256', 'originObservationSha256', 'causality']);
  assert.equal(plan.evidence.providerDocumentation, 'https://docs.npmjs.com/staged-publishing/');
  assert.deepEqual(plan.evidence.observedDuring, { tag: 'v3.2.0-rc.1', commit: '6e5e2e4937e5ed9dc60e6669cb4887508ccdbdb8', runId: 40433276229, runAttempt: 1, publisherJobId: 121964065609,
    publisherLogSha256: '3497f3798b51fb3e519c576e542929aa64a984b3b27d3bea18723ef4a945017c', routerArchiveSha256: '3d56164da29f88210af82f44a0f4a9940384ff1113112d537fde61cba4aab45a' });
  for (const field of ['registryObservationSha256', 'archiveAuthenticationSha256', 'originObservationSha256']) hash(plan.evidence[field]);
  assert.equal(plan.evidence.causality, 'Observed during ordinary RC1 npm publish; no explicit stage command or internal backend mechanism is established.');
  return plan;
}
export function placeholderPlan(root = ROOT) {
  const bytes = bytesAt(join(root, PLACEHOLDER_PLAN_PATH));
  return { plan: validatePlaceholderPlan(JSON.parse(bytes)), bytes, sha256: sha(bytes) };
}
export function placeholderMetadata(row, publishedAt) {
  return { name: row?.name, version: row?.version, _id: row?._id, stub: row?.stub,
    description: row?.description, publishedAt, fileCount: row?.dist?.fileCount, unpackedSize: row?.dist?.unpackedSize };
}
export function validatePlaceholderMetadata(row, publishedAt, plan) {
  validatePlaceholderPlan(plan); assert.deepEqual(placeholderMetadata(row, publishedAt), plan.metadata, 'placeholder registry identity differs');
  assert.equal(row.dist.tarball, plan.archive.url); assert.equal(row.dist.shasum, plan.archive.sha1); assert.equal(row.dist.integrity, plan.archive.integrity);
}
export function validatePlaceholderArchive(bytes, plan) {
  validatePlaceholderPlan(plan); assert.equal(bytes.length, plan.archive.bytes, 'placeholder archive length differs');
  assert.equal(sha(bytes), plan.archive.sha256, 'placeholder archive SHA256 differs');
  assert.equal(createHash('sha1').update(bytes).digest('hex'), plan.archive.sha1);
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, plan.archive.integrity);
}
function context(value, job) {
  exact(value, ['tag', 'commit', 'runId', 'runAttempt', 'workflow', 'event', 'job']);
  assert.equal(value.tag, PLACEHOLDER_HOST); assert.match(value.commit, /^[a-f0-9]{40}$/); positive(value.runId); positive(value.runAttempt);
  assert.equal(value.workflow, WORKFLOW); assert.equal(value.event, 'push'); assert.equal(value.job, job);
  assert(!['6e5e2e4937e5ed9dc60e6669cb4887508ccdbdb8', '3b6c7766a1b47558e666f76236a53697b3737bde'].includes(value.commit), 'placeholder requires successor source');
  return value;
}
const makeContext = (args, job) => context({ tag: args.tag, commit: args.commit, runId: Number(args.runId), runAttempt: Number(args.runAttempt), workflow: WORKFLOW, event: 'push', job }, job);
async function currentContext(args, owner, binding) {
  const root = args.root ?? ROOT;
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), owner.commit);
  assert.equal(run('git', ['rev-parse', `${owner.tag}^{commit}`], root).trim(), owner.commit);
  assert.match(run('git', ['rev-parse', `${owner.tag}^{tag}`], root).trim(), /^[a-f0-9]{40}$/, 'placeholder host requires an annotated tag');
  assert.equal(sha(run('git', ['show', `${owner.commit}:${PLACEHOLDER_PLAN_PATH}`], root)), binding.sha256, 'working plan differs from tagged source');
  const get = releaseReader({ fetchImpl: args.fetchImpl ?? fetch, token: args.token ?? process.env.GH_TOKEN });
  const actual = await get(`${API}/actions/runs/${owner.runId}/attempts/${owner.runAttempt}`);
  assert.equal(actual.repository?.full_name, 'getforma-dev/forma'); assert.equal(actual.id, owner.runId); assert.equal(actual.run_attempt, owner.runAttempt);
  assert.equal(actual.head_sha, owner.commit); assert.equal(actual.head_branch, owner.tag); assert.equal(actual.path, WORKFLOW); assert.equal(actual.event, 'push'); assert.equal(actual.status, 'in_progress');
  assert.equal(actual.conclusion, null, 'active producer must not claim a conclusion');
  return actual;
}
function observation(value, plan) {
  exact(value, ['observedAt', 'metadataSource', 'metadata', 'publishedAt', 'archiveBase64']); timestamp(value.observedAt);
  assert.equal(value.metadataSource, METADATA_URL);
  exact(value.metadata, ['name', 'version', '_id', 'stub', 'description', 'dist']);
  exact(value.metadata.dist, ['tarball', 'shasum', 'integrity', 'fileCount', 'unpackedSize']);
  validatePlaceholderMetadata(value.metadata, value.publishedAt, plan);
  assert.equal(typeof value.archiveBase64, 'string'); const bytes = Buffer.from(value.archiveBase64, 'base64');
  assert.equal(bytes.toString('base64'), value.archiveBase64, 'noncanonical placeholder archive encoding'); validatePlaceholderArchive(bytes, plan);
}
export function validatePlaceholderReceipt(receipt, { hostTag, hostCommit, hostRunId, binding = placeholderPlan() }) {
  exact(receipt, ['contract', 'disposition', 'qualificationEligible', 'supportEligible', 'performanceBaselineEligible', 'soakEligible', 'planSha256', 'preparedBy', 'recordedBy', 'preparedManifestSha256', 'prepared', 'observation']);
  assert.equal(receipt.contract, PLACEHOLDER_CONTRACT); assert.equal(hostTag, PLACEHOLDER_HOST);
  for (const key of ['disposition', 'qualificationEligible', 'supportEligible', 'performanceBaselineEligible', 'soakEligible']) assert.equal(receipt[key], binding.plan[key]);
  assert.equal(receipt.planSha256, binding.sha256); hash(receipt.preparedManifestSha256);
  context(receipt.preparedBy, 'check'); context(receipt.recordedBy, 'record');
  for (const ctx of [receipt.preparedBy, receipt.recordedBy]) { assert.equal(ctx.commit, hostCommit); assert.equal(ctx.runId, Number(hostRunId)); }
  assert(receipt.preparedBy.runAttempt <= receipt.recordedBy.runAttempt, 'placeholder preparation is from a future attempt');
  observation(receipt.observation, binding.plan);
  exact(receipt.prepared, ['content', 'manifest']);
  const prepared = { contract: PREPARED, planSha256: binding.sha256, preparedBy: receipt.preparedBy, observation: receipt.observation };
  const content = JSON.stringify(prepared, null, 2) + '\n';
  assert.equal(receipt.prepared.content, content, 'retained prepared.json differs from its canonical fields');
  const manifest = JSON.stringify({ schema: 1, entries: [{ path: 'prepared.json', type: 'file', bytes: Buffer.byteLength(content), sha256: sha(content) }] }, null, 2) + '\n';
  assert.equal(receipt.prepared.manifest, manifest, 'retained one-file evidence manifest differs');
  assert.equal(sha(manifest), receipt.preparedManifestSha256, 'retained evidence manifest digest differs');
  return receipt;
}

function execution(jobs, attempt, owner, requiredSteps) {
  assert(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length && jobs.jobs.length <= 100);
  assert.equal(new Set(jobs.jobs.map(job => job.id)).size, jobs.jobs.length);
  const matches = jobs.jobs.filter(job => job.name === owner.job); assert.equal(matches.length, 1);
  const job = matches[0]; positive(job.id); assert.equal(job.run_id, owner.runId); assert.equal(job.run_attempt, owner.runAttempt);
  assert.equal(job.head_sha, owner.commit); assert.equal(job.head_branch, owner.tag); assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success');
  assert(Date.parse(job.started_at) >= Date.parse(attempt.run_started_at) && Date.parse(job.completed_at) >= Date.parse(job.started_at), `${owner.job} must actually execute in its producer attempt`);
  for (const name of requiredSteps) {
    const steps = job.steps?.filter(step => step.name === name); assert.equal(steps?.length, 1); assert.equal(steps[0].conclusion, 'success');
    assert(Date.parse(steps[0].started_at) >= Date.parse(job.started_at) && Date.parse(steps[0].completed_at) >= Date.parse(steps[0].started_at) && Date.parse(steps[0].completed_at) <= Date.parse(job.completed_at), 'producer step interval differs');
  }
  return job;
}
async function authenticatePreparation(receipt, get, { activeRecorder, consumerStartedAt } = {}) {
  const owner = receipt.preparedBy, base = `${API}/actions/runs/${owner.runId}/attempts/${owner.runAttempt}`;
  const [attempt, jobs] = await Promise.all([get(base), get(`${base}/jobs?per_page=100`)]);
  if (activeRecorder && owner.runAttempt === receipt.recordedBy.runAttempt) {
    assert.equal(attempt.status, 'in_progress'); assert.equal(attempt.conclusion, null);
    assert.equal(attempt.repository?.full_name, 'getforma-dev/forma'); assert.equal(attempt.head_sha, owner.commit);
    assert.equal(attempt.head_branch, owner.tag); assert.equal(attempt.path, owner.workflow); assert.equal(attempt.event, owner.event);
  } else verifyRun(attempt, owner, { producerFailure: true });
  assert.equal(attempt.id, owner.runId); assert.equal(attempt.run_attempt, owner.runAttempt);
  const job = execution(jobs, attempt, owner, [PREPARE_STEP, UPLOAD_STEP]);
  const prepare = job.steps.find(step => step.name === PREPARE_STEP), upload = job.steps.find(step => step.name === UPLOAD_STEP);
  assert(Date.parse(prepare.completed_at) <= Date.parse(upload.started_at), 'placeholder upload precedes preparation');
  const observed = Date.parse(receipt.observation.observedAt);
  assert(observed >= Date.parse(prepare.started_at) && observed < Date.parse(prepare.completed_at) + 1000, 'registry observation is outside its original preparation step');
  if (activeRecorder) {
    const recorder = receipt.recordedBy;
    const inventory = owner.runAttempt === recorder.runAttempt ? jobs : await get(`${API}/actions/runs/${recorder.runId}/attempts/${recorder.runAttempt}/jobs?per_page=100`);
    assert(Array.isArray(inventory.jobs) && inventory.total_count === inventory.jobs.length && inventory.jobs.length <= 100);
    assert.equal(new Set(inventory.jobs.map(item => item.id)).size, inventory.jobs.length);
    const records = inventory.jobs.filter(item => item.name === 'record'); assert.equal(records.length, 1);
    const current = records[0]; positive(current.id); assert.equal(current.run_id, recorder.runId); assert.equal(current.run_attempt, recorder.runAttempt);
    assert.equal(current.head_sha, recorder.commit); assert.equal(current.head_branch, recorder.tag); assert.equal(current.status, 'in_progress'); assert.equal(current.conclusion, null);
    assert(Date.parse(current.started_at) >= Date.parse(activeRecorder.run_started_at), 'active recorder is a copied earlier execution');
    consumerStartedAt = current.started_at;
  }
  assert(Date.parse(upload.completed_at) <= Date.parse(consumerStartedAt), 'placeholder upload did not complete before recorder execution');
  return { jobId: job.id, runAttempt: owner.runAttempt, attemptStatus: attempt.status, attemptConclusion: attempt.conclusion };
}

// Called by the consumer only after publication. Never claim that a currently
// executing record job has already succeeded. GET uses the caller's bounded,
// allowlisted transport so this shares the reconciliation deadline and token scope.
export async function authenticatePlaceholderHost({ receipt, binding, get }) {
  const host = receipt.recordedBy, base = `${API}/actions/runs/${host.runId}`;
  const [latest, attempt, jobs, ref, source] = await Promise.all([
    get(base), get(`${base}/attempts/${host.runAttempt}`), get(`${base}/attempts/${host.runAttempt}/jobs?per_page=100`),
    get(`${API}/git/ref/tags/${PLACEHOLDER_HOST}`), get(`${API}/contents/${PLACEHOLDER_PLAN_PATH}?ref=${host.commit}`),
  ]);
  verifyRun(attempt, host); assert.equal(attempt.id, host.runId); assert.equal(attempt.run_attempt, host.runAttempt);
  assert.equal(latest.repository?.full_name, 'getforma-dev/forma'); assert.equal(latest.id, host.runId);
  assert.equal(latest.head_sha, host.commit); assert.equal(latest.head_branch, host.tag); assert.equal(latest.path, host.workflow); assert.equal(latest.event, host.event);
  positive(latest.run_attempt); assert(latest.run_attempt >= host.runAttempt, 'latest run predates the recorder');
  assert(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(latest.status));
  if (latest.status === 'completed') assert(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale'].includes(latest.conclusion));
  else assert.equal(latest.conclusion, null, 'unfinished latest run has a conclusion');
  if (latest.run_attempt === host.runAttempt) verifyRun(latest, host);
  assert.equal(ref.ref, `refs/tags/${PLACEHOLDER_HOST}`); assert.equal(ref.object?.type, 'tag'); assert.match(ref.object.sha, /^[a-f0-9]{40}$/);
  const tag = await get(`${API}/git/tags/${ref.object.sha}`);
  assert.equal(tag.sha, ref.object.sha); assert.equal(tag.tag, PLACEHOLDER_HOST); assert.equal(tag.object?.type, 'commit'); assert.equal(tag.object.sha, host.commit);
  assert.equal(source.type, 'file'); assert.equal(source.path, PLACEHOLDER_PLAN_PATH); assert.equal(source.encoding, 'base64');
  const sourceBytes = Buffer.from(source.content, 'base64'); assert.equal(source.size, sourceBytes.length); assert.equal(sha(sourceBytes), binding.sha256, 'host source plan differs');
  assert.deepEqual(JSON.parse(sourceBytes), binding.plan);
  const job = execution(jobs, attempt, host, ['Write DS12, the compatibility record and elapsed time']);
  const prepared = await authenticatePreparation(receipt, get, { consumerStartedAt: job.started_at });
  return { prepared, recorded: { jobId: job.id, runAttempt: host.runAttempt },
    latestObserved: { runAttempt: latest.run_attempt, status: latest.status, conclusion: latest.conclusion } };
}

export async function prepareProviderPlaceholder(args) {
  if (args.tag !== PLACEHOLDER_HOST) return null;
  const root = args.root ?? ROOT, binding = placeholderPlan(root), preparedBy = makeContext(args, 'check');
  await currentContext(args, preparedBy, binding);
  const fetchImpl = args.fetchImpl ?? fetch;
  const publicBytes = async (url, limit) => boundedResponse(await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'getforma-provider-placeholder-audit' } }), limit);
  const metadata = JSON.parse(await publicBytes(METADATA_URL, 1024 * 1024)); assert.equal(metadata.name, binding.plan.name);
  const row = metadata.versions?.[binding.plan.version], publishedAt = metadata.time?.[binding.plan.version]; validatePlaceholderMetadata(row, publishedAt, binding.plan);
  const bytes = await publicBytes(binding.plan.archive.url, binding.plan.archive.bytes); validatePlaceholderArchive(bytes, binding.plan);
  const obs = { observedAt: new Date().toISOString(), metadataSource: METADATA_URL,
    metadata: { name: row.name, version: row.version, _id: row._id, stub: row.stub, description: row.description,
      dist: { tarball: row.dist.tarball, shasum: row.dist.shasum, integrity: row.dist.integrity, fileCount: row.dist.fileCount, unpackedSize: row.dist.unpackedSize } },
    publishedAt, archiveBase64: bytes.toString('base64') };
  observation(obs, binding.plan); mkdirSync(args.directory);
  writeJson(join(args.directory, 'prepared.json'), { contract: PREPARED, planSha256: binding.sha256, preparedBy, observation: obs });
  return { manifestSha256: await recordEvidence(args.directory) };
}

export async function consumeProviderPlaceholder(args) {
  if (args.tag !== PLACEHOLDER_HOST) { assert(!args.directory && !args.expectedSha256, 'unplanned placeholder artifact'); return { providerPlaceholders: [], assets: [] }; }
  assert(args.directory && args.outputDirectory, 'planned placeholder artifact required'); hash(args.expectedSha256);
  const output = resolve(args.outputDirectory), input = resolve(args.directory); assert(output !== input && !output.startsWith(input + sep));
  await verifyEvidence(input, args.expectedSha256);
  assert.deepEqual(readdirSync(input).sort(), [EVIDENCE_MANIFEST, 'prepared.json'].sort(), 'unexpected placeholder transfer members');
  const binding = placeholderPlan(args.root ?? ROOT), prepared = JSON.parse(bytesAt(join(input, 'prepared.json')));
  exact(prepared, ['contract', 'planSha256', 'preparedBy', 'observation']); assert.equal(prepared.contract, PREPARED); assert.equal(prepared.planSha256, binding.sha256);
  const receipt = { contract: PLACEHOLDER_CONTRACT, disposition: binding.plan.disposition, qualificationEligible: false, supportEligible: false,
    performanceBaselineEligible: false, soakEligible: false, planSha256: binding.sha256,
    preparedBy: prepared.preparedBy, recordedBy: makeContext(args, 'record'), preparedManifestSha256: args.expectedSha256,
    prepared: { content: bytesAt(join(input, 'prepared.json')).toString('utf8'), manifest: bytesAt(join(input, EVIDENCE_MANIFEST)).toString('utf8') }, observation: prepared.observation };
  validatePlaceholderReceipt(receipt, { hostTag: args.tag, hostCommit: args.commit, hostRunId: args.runId, binding });
  const activeRecorder = await currentContext(args, receipt.recordedBy, binding);
  await authenticatePreparation(receipt, releaseReader({ fetchImpl: args.fetchImpl ?? fetch, token: args.token ?? process.env.GH_TOKEN }), { activeRecorder });
  mkdirSync(output, { recursive: true }); const path = join(output, PLACEHOLDER_ASSET), identity = writeJson(path, receipt);
  return { providerPlaceholders: [{ contract: PLACEHOLDER_CONTRACT, asset: PLACEHOLDER_ASSET, ...identity }], assets: [path] };
}
async function main() {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], 'prepare');
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.GITHUB_REPOSITORY, 'getforma-dev/forma');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push'); assert.equal(process.env.GITHUB_REF_TYPE, 'tag'); assert.equal(process.env.GITHUB_JOB, 'check');
  const result = await prepareProviderPlaceholder({ tag: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, directory: process.argv[3] });
  assert(process.env.GITHUB_OUTPUT); appendFileSync(process.env.GITHUB_OUTPUT, `manifest-sha256=${result?.manifestSha256 ?? ''}\n`);
  console.log(result ? 'Provider placeholder bytes authenticated for the prospective RC3 inventory receipt.' : 'No provider placeholder receipt is planned for this tag.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(`release-provider-placeholder: ${error.message}`); process.exitCode = 1; });
