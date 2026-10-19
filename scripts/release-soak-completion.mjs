#!/usr/bin/env node
// Read-only post-publication consumer. The original final DS12 stays deferred;
// a later successful campaign receives its own externally retained receipt.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, assertMilestoneReady, json, run } from './release-set.mjs';
import { RELEASE_RECORD_MAX_BYTES } from './release-record-limits.mjs';
import { readRecordedSet, publishedRelease } from './release-support.mjs';
import { API, authenticateRc, downloadRunEvidence, namedAsset, releaseReader, sha256, verifyAssetBytes } from './release-burn-in-inputs.mjs';
import { finalDiffBinding, validateAuthenticatedBurnIn } from './release-burn-in-final.mjs';
import { readSoakDeferral, soakDisposition } from './release-soak-deferral.mjs';

function timestamp(value, label) {
  assert.equal(typeof value, 'string', `${label}: missing UTC time`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/, `${label}: malformed UTC time`);
  const ms = Date.parse(value); assert(Number.isFinite(ms), `${label}: invalid time`);
  assert.equal(new Date(ms).toISOString().slice(0, 19), value.slice(0, 19), `${label}: invalid calendar time`);
  return ms;
}

export async function verifyPostReleaseSoak({ tag, commit, runId, runAttempt, manifestSha256, directory,
  root = ROOT, fetchImpl = fetch, token = process.env.GH_TOKEN, authenticate = authenticateRc } = {}) {
  assert.equal(tag, 'v3.0.0', 'post-release soak is only authorized for v3.0.0');
  assert.match(commit ?? '', /^[a-f0-9]{40}$/);
  assert(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(runAttempt) && runAttempt > 0, 'actual soak run ID and attempt required');
  assert.match(manifestSha256 ?? '', /^[a-f0-9]{64}$/, 'actual soak manifest digest required');
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit, 'requires exact final checkout');
  assert.equal(run('git', ['rev-parse', `${tag}^{commit}`], root).trim(), commit, 'final tag differs from checkout');
  assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no'], root).trim(), '', 'final tracked source must be clean');
  const contracts = json(join(root, 'scripts/release-contracts.json'));
  assertMilestoneReady(contracts, '3.0.0');
  const deferred = readSoakDeferral(root, contracts), reference = deferred.reference;
  const changes = finalDiffBinding(reference, commit, root);
  assert.equal(run('git', ['rev-parse', `${reference.rcTag}^{commit}`], root).trim(), reference.rcCommit, 'deferred RC tag differs');
  assert.equal(typeof directory, 'string'); assert(isAbsolute(directory), 'output directory must be absolute');
  // Resolve the existing parent so a symlink cannot disguise in-checkout output.
  const output = join(realpathSync(dirname(directory)), directory.split(sep).at(-1));
  const inside = relative(realpathSync(root), output);
  assert(inside && (inside.startsWith(`..${sep}`) || isAbsolute(inside)), 'output must be outside the tagged checkout');
  assert(!existsSync(output), 'output directory must be fresh'); mkdirSync(output, { mode: 0o700 });
  const save = (name, value) => writeFileSync(join(output, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    const get = releaseReader({ fetchImpl, token });
    const metadata = await get(`${API}/releases/tags/${tag}`); save('final-release-metadata.json', metadata);
    assert(Number.isSafeInteger(metadata.id) && metadata.id > 0, 'missing published final release identity');
    const asset = namedAsset(metadata, 'release-record.json', RELEASE_RECORD_MAX_BYTES);
    const bytes = verifyAssetBytes(asset, await get(asset.url, { binary: true, limit: RELEASE_RECORD_MAX_BYTES }));
    save('final-release-record.json', bytes);
    const record = readRecordedSet(bytes, asset.digest.slice(7)), publication = publishedRelease(record, metadata);
    assert.equal(record.tag, tag); assert.equal(record.commit, commit); assert.equal(record.milestone?.name, 'final');
    assert.equal(record.burnIn, undefined, 'final record must retain the original deferred disposition');
    assert.deepEqual(record.postReleaseSoak, { ...soakDisposition(reference), file: deferred.assetName, sha256: deferred.sha256 }, 'final DS12 deferred binding differs');
    const referenceAsset = namedAsset(metadata, deferred.assetName, 4 * 1024 * 1024);
    const referenceBytes = verifyAssetBytes(referenceAsset, await get(referenceAsset.url, { binary: true, limit: 4 * 1024 * 1024 }));
    save(deferred.assetName, referenceBytes);
    assert.deepEqual(referenceBytes, deferred.bytes, 'published final reference differs from committed source');
    const authenticated = await authenticate({ tag: reference.rcTag, commit: reference.rcCommit, directory: join(output, 'rc'), root, checkoutRequired: false, fetchImpl, token });
    for (const key of ['ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256']) assert.equal(authenticated[key], reference[key], `deferred RC ${key} differs`);
    const evidence = await downloadRunEvidence({ get, runId, runAttempt, name: 'rc-burn-in', manifestSha256,
      destination: join(output, 'run'), commit: reference.rcCommit, tag: reference.rcTag,
      workflow: '.github/workflows/rc-burn-in.yml', event: 'workflow_dispatch', requiredJob: 'burn-in', requiredStep: 'Continuous packed RC workloads' });
    save('soak-hosted-provenance.json', { run: evidence.run, jobs: evidence.jobs, artifact: evidence.artifact });
    const publishedMs = timestamp(publication.publishedAt, 'final publication');
    const createdMs = timestamp(evidence.run.created_at, 'soak run creation'), startedMs = timestamp(evidence.run.run_started_at, 'soak attempt start');
    assert(createdMs >= publishedMs && startedMs >= createdMs, 'soak run must be created and started after final publication');
    const report = validateAuthenticatedBurnIn(evidence, reference, authenticated, root);
    const receipt = { contract: 'post-release-soak-verification-v1', status: 'passed', decision: reference.decision,
      final: { tag, commit, releaseId: metadata.id, publishedAt: publication.publishedAt, ds12Sha256: sha256(bytes), referenceSha256: deferred.sha256,
        originalDisposition: record.postReleaseSoak },
      rc: { tag: reference.rcTag, commit: reference.rcCommit, ds12Sha256: authenticated.ds12Sha256,
        p17EvidenceSha256: authenticated.p17EvidenceSha256, d14EvidenceSha256: authenticated.d14EvidenceSha256 },
      soak: { runId, runAttempt, manifestSha256, artifactSha256: evidence.artifact.digest.slice(7), createdAt: evidence.run.created_at,
        startedAt: evidence.run.run_started_at, activeNanoseconds: report.activeNanoseconds, rounds: report.rounds.length,
        zeroFaults: true, cleanup: report.cleanup, hostedAttestationVerified: true }, reviewedFinalChanges: changes };
    save('verification.json', receipt); return receipt;
  } catch (error) {
    save('verification-error.json', { status: 'failed', tag, commit, runId, runAttempt, manifestSha256, error: String(error.message) });
    throw error;
  }
}

export async function soakCompletionCli(args, options = {}) {
  const [tag, commit, id, attempt, manifestSha256, directory, ...extra] = args;
  assert(extra.length === 0 && /^[1-9][0-9]*$/.test(id ?? '') && /^[1-9][0-9]*$/.test(attempt ?? '') && directory,
    'usage: release-soak-completion.mjs v3.0.0 FINAL_COMMIT RUN_ID RUN_ATTEMPT MANIFEST_SHA256 ABSOLUTE_FRESH_OUTPUT_DIRECTORY');
  return verifyPostReleaseSoak({ ...options, tag, commit, runId: Number(id), runAttempt: Number(attempt), manifestSha256, directory });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const receipt = await soakCompletionCli(process.argv.slice(2)); console.log(JSON.stringify(receipt)); }
  catch (error) { console.error(`Post-release soak: ${error.message}`); process.exitCode = 1; }
}
