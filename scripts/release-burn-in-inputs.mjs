// Authenticate published RC inputs before any stress workload is staged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, run } from './release-set.mjs';
import { readRecordedSet, publishedRelease } from './release-support.mjs';
import { githubReleaseMetadata } from './release-support-history.mjs';
import { publishedStatus } from './published-scaffold.mjs';
import { bindAuditToRc, validateAuditEvidence, AUDIT_FILES } from './release-audit.mjs';
import { verifyEvidence } from './release-evidence.mjs';
import { RELEASE_RECORD_MAX_BYTES } from './release-record-limits.mjs';
import { evidenceRoom, writeEvidence } from './release-burn-in-storage.mjs';
export const API = 'https://api.github.com/repos/getforma-dev/forma';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MiB = 1024 * 1024;
export async function boundedResponse(response, limit) {
  assert(response.ok, `release input unreadable (${response.status})`);
  const declared = response.headers.get('content-length');
  if (declared !== null) assert(/^\d+$/.test(declared) && Number(declared) <= limit, 'release input exceeds byte limit');
  let size = 0; const chunks = [];
  for await (const part of response.body) { size += part.length; assert(size <= limit, 'release input exceeds byte limit'); chunks.push(Buffer.from(part)); }
  return Buffer.concat(chunks);
}
export function releaseReader({ fetchImpl = fetch, token = process.env.GH_TOKEN } = {}) {
  return async (url, { binary = false, limit = binary ? 8 * MiB : 4 * MiB, destination, evidenceRoot } = {}) => {
    assert(url.startsWith(`${API}/`), 'untrusted release API URL');
    const response = await fetchImpl(url, { headers: { Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'getforma-rc-burn-in', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(60_000) });
    if (destination) {
      assert(binary && response.ok, 'artifact download failed');
      if (evidenceRoot) limit = Math.min(limit, evidenceRoom(evidenceRoot));
      const declared = response.headers.get('content-length');
      if (declared !== null) assert(/^\d+$/.test(declared) && Number(declared) <= limit, 'artifact exceeds byte limit');
      const fd = openSync(destination, 'wx'), hash = createHash('sha256'); let bytes = 0;
      try {
        for await (const part of response.body) {
          bytes += part.length; assert(bytes <= limit, 'artifact exceeds byte limit'); hash.update(part);
          let offset = 0; while (offset < part.length) offset += writeSync(fd, part, offset);
        }
        fsyncSync(fd); return { bytes, sha256: hash.digest('hex') };
      } finally { closeSync(fd); }
    }
    const bytes = await boundedResponse(response, limit);
    return binary ? bytes : JSON.parse(bytes);
  };
}
export function namedAsset(metadata, name, limit = 8 * MiB) {
  assert(Array.isArray(metadata.assets)); const matches = metadata.assets.filter(row => row.name === name); assert.equal(matches.length, 1, `requires exactly one ${name}`);
  const asset = matches[0]; assert.match(asset.url, /^https:\/\/api\.github\.com\/repos\/getforma-dev\/forma\/releases\/assets\/[1-9][0-9]*$/);
  assert.match(asset.digest ?? '', /^sha256:[a-f0-9]{64}$/); assert(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= limit);
  return asset;
}
export function verifyAssetBytes(asset, bytes) { assert.equal(bytes.length, asset.size, 'asset size differs'); assert.equal(sha256(bytes), asset.digest.slice(7), 'asset digest differs'); return bytes; }
export function verifyRun(run, { commit, tag, workflow, event }, { producerFailure = false } = {}) {
  assert.equal(run.repository?.full_name, 'getforma-dev/forma'); assert.equal(run.head_sha, commit);
  assert.equal(run.head_branch, tag); assert.equal(run.path, workflow); assert.equal(run.event, event);
  assert.equal(run.status, 'completed');
  assert(producerFailure ? ['success', 'failure'].includes(run.conclusion) : run.conclusion === 'success', 'workflow attempt did not succeed');
  assert(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  return run;
}
export async function downloadRunEvidence({ get, runId, runAttempt, name, manifestSha256, destination, commit, tag, workflow, event, requiredJob, requiredStep, evidenceRoot = destination, reserveBytes = 0 }) {
  assert(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(runAttempt) && runAttempt > 0); assert.match(manifestSha256 ?? '', /^[a-f0-9]{64}$/);
  // A record-only retry can make an earlier overall release attempt fail even
  // though its immutable verify job succeeded. The latest run must now succeed,
  // and the exact earlier producer job/step still has to pass below.
  const p17 = name === 'release-p17';
  if (p17) {
    assert.equal(workflow, '.github/workflows/release.yml'); assert.equal(event, 'push');
    assert.equal(requiredJob, 'verify'); assert.equal(requiredStep, 'P17 packed corpus and both templates');
  }
  const latest = p17 ? verifyRun(await get(`${API}/actions/runs/${runId}`), { commit, tag, workflow, event }) : null;
  if (latest) { assert.equal(latest.id, runId); assert(runAttempt <= latest.run_attempt, 'future producer attempt'); }
  const runProof = verifyRun(await get(`${API}/actions/runs/${runId}/attempts/${runAttempt}`), { commit, tag, workflow, event }, { producerFailure: p17 && runAttempt < latest.run_attempt });
  assert.equal(runProof.id, runId); assert.equal(runProof.run_attempt, runAttempt);
  const jobs = await get(`${API}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`);
  assert(Number.isSafeInteger(jobs.total_count) && jobs.total_count > 0 && jobs.total_count <= 100 && jobs.jobs.length === jobs.total_count);
  const job = jobs.jobs.filter(row => row.name === requiredJob); assert.equal(job.length, 1); assert.equal(job[0].conclusion, 'success');
  assert(job[0].steps.some(step => step.name === requiredStep && step.conclusion === 'success'), 'required actual workload step did not pass');
  const inventory = await get(`${API}/actions/runs/${runId}/artifacts?per_page=100`);
  assert(Number.isSafeInteger(inventory.total_count) && inventory.total_count <= 100 && inventory.artifacts.length === inventory.total_count);
  const artifacts = inventory.artifacts.filter(row => row.name === name); assert.equal(artifacts.length, 1, 'missing or duplicated evidence artifact');
  const artifact = artifacts[0]; assert.equal(artifact.expired, false); assert.equal(artifact.workflow_run?.id, runId); assert.equal(artifact.workflow_run?.head_sha, commit);
  assert.match(artifact.digest ?? '', /^sha256:[a-f0-9]{64}$/); assert(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 2 * 1024 * MiB);
  assert.match(artifact.archive_download_url, /^https:\/\/api\.github\.com\/repos\/getforma-dev\/forma\/actions\/artifacts\/[1-9][0-9]*\/zip$/);
  mkdirSync(destination);
  const downloaded = await get(artifact.archive_download_url, { binary: true, limit: Math.min(2 * 1024 * MiB, evidenceRoom(evidenceRoot, reserveBytes) - reserveBytes), destination: join(destination, 'artifact.zip'), evidenceRoot });
  assert.equal(downloaded.bytes, artifact.size_in_bytes); assert.equal(downloaded.sha256, artifact.digest.slice(7));
  const files = join(destination, 'files');
  run('python3', [join(ROOT, 'scripts/release-unpack.py'), 'zip', join(destination, 'artifact.zip'), files, String(evidenceRoom(evidenceRoot, reserveBytes) - reserveBytes)]);
  evidenceRoom(evidenceRoot);
  await verifyEvidence(files, manifestSha256);
  return { files, run: runProof, latestSuccessfulRun: latest, jobs, artifact, manifestSha256 };
}
export function verifyRegistryArchive(item, published, bytes) {
  assert.equal(published.registry, item.registry); assert.equal(published.name, item.name); assert.equal(published.version, item.version);
  assert.equal(sha256(bytes), item.sha256, `${item.name}: DS12 archive differs`);
  if (item.registry === 'npm') assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, published.metadata.dist.integrity);
  else assert.equal(sha256(bytes), published.metadata.version.checksum);
  return { ...item, bytes: bytes.length };
}
export async function authenticateRc({ tag, commit, directory, fetchImpl = fetch, token = process.env.GH_TOKEN, root = ROOT, checkoutRequired = true }) {
  assert.match(tag ?? '', /^v3\.0\.0-rc\.[1-9][0-9]*$/); assert.match(commit ?? '', /^[a-f0-9]{40}$/);
  if (checkoutRequired) assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit);
  assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no'], root).trim(), '');
  assert.equal(run('git', ['rev-parse', `${tag}^{commit}`], root).trim(), commit, 'checkout is not the immutable RC tag');
  mkdirSync(directory); const get = releaseReader({ fetchImpl, token });
  const metadata = await githubReleaseMetadata(tag, { fetchImpl, token });
  const getAsset = async name => {
    const limit = name === 'release-record.json' ? RELEASE_RECORD_MAX_BYTES : 8 * MiB;
    const asset = namedAsset(metadata, name, limit); evidenceRoom(directory, asset.size);
    return verifyAssetBytes(asset, await get(asset.url, { binary: true, limit: Math.min(limit, evidenceRoom(directory)) }));
  };
  const ds12 = await getAsset('release-record.json'), record = readRecordedSet(ds12, sha256(ds12));
  publishedRelease(record, metadata); assert.equal(record.tag, tag); assert.equal(record.commit, commit); assert.equal(record.milestone?.name, 'rc');
  writeEvidence(directory, join(directory, 'release-record.json'), ds12); writeEvidence(directory, join(directory, 'release-metadata.json'), JSON.stringify(metadata));
  const p17 = record.p17Evidence; assert.equal(p17?.artifactName, 'release-p17');
  const p17Proof = await downloadRunEvidence({ get, ...p17, name: p17.artifactName, destination: join(directory, 'p17'), commit, tag, workflow: '.github/workflows/release.yml', event: 'push', requiredJob: 'verify', requiredStep: 'P17 packed corpus and both templates', evidenceRoot: directory, reserveBytes: 64 * MiB });
  assert.deepEqual(JSON.parse(readFileSync(join(p17Proof.files, 'p17.json'))), record.measurements, 'nested P17 differs from DS12');
  const audit = {};
  for (const name of AUDIT_FILES) { audit[name] = await getAsset(name); assert.equal(sha256(audit[name]), record.d14?.[name], `DS12 ${name} binding differs`); writeEvidence(directory, join(directory, name), audit[name]); }
  const binding = bindAuditToRc({ rcCommit: commit, reportBytes: audit['d14-report.json'], inputBytes: audit['d14-input-manifest.json'], root });
  binding.reviewEvidenceSha256 = validateAuditEvidence(JSON.parse(audit['d14-report.json']), audit['d14-review-evidence.json']);
  assert.deepEqual(JSON.parse(audit['d14-rc-binding.json']), binding);
  const sums = (await getAsset('SHA256SUMS')).toString('utf8'), entries = new Map();
  for (const line of sums.trim().split('\n')) { const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line); assert(match && !entries.has(match[2]), 'malformed/duplicate published checksum'); entries.set(match[2], match[1]); }
  const registry = await publishedStatus(tag.slice(1), fetchImpl); assert.equal(registry.ready, true, 'all seven RC packages must be published');
  const archives = join(directory, 'archives'); mkdirSync(archives); const packages = [];
  for (const item of record.packages) {
    assert.match(item.file, /^[A-Za-z0-9][A-Za-z0-9._-]*$/); assert.equal(entries.get(item.file), item.sha256);
    const matches = registry.packages.filter(row => row.registry === item.registry && row.name === item.name); assert.equal(matches.length, 1);
    const published = matches[0], url = item.registry === 'npm' ? published.metadata.dist.tarball : `https://static.crates.io/crates/${item.name}/${item.name}-${item.version}.crate`;
    const bytes = await boundedResponse(await fetchImpl(url, { signal: AbortSignal.timeout(60_000) }), Math.min(128 * MiB, evidenceRoom(directory)));
    packages.push(verifyRegistryArchive(item, published, bytes)); writeEvidence(directory, join(archives, item.file), bytes);
  }
  writeEvidence(directory, join(directory, 'registry.json'), JSON.stringify(registry));
  writeEvidence(directory, join(directory, 'p17-provenance.json'), JSON.stringify(p17Proof));
  return { set: record, archives, packages, ds12Sha256: sha256(ds12), p17EvidenceSha256: p17.manifestSha256, d14EvidenceSha256: sha256(audit['d14-rc-binding.json']) };
}
