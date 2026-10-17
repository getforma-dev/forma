#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, run, ROOT, assertMilestoneReady, milestoneOf } from './release-set.mjs';
import { releaseNotesLine } from './release-measurements.mjs';
import { githubReleaseMetadata, readSupportHistory } from './release-support-history.mjs';
import { renderSecurity } from './release-support.mjs';
import { verifyEvidence } from './release-evidence.mjs';
import { AUDIT_FILES, readRcAudit } from './release-audit.mjs';
import { RELEASE_RECORD_MAX_BYTES } from './release-record-limits.mjs';

export function releaseRecordBytes(record, maxBytes = RELEASE_RECORD_MAX_BYTES) {
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  assert(bytes.length <= maxBytes, 'DS12 release record exceeds transport byte limit');
  return bytes;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function runNumber(value, name) {
  assert(typeof value === 'string' && /^[1-9][0-9]*$/.test(value), `${name}: positive workflow identity required`);
  const number = Number(value);
  assert(Number.isSafeInteger(number), `${name}: unsafe workflow identity`);
  return number;
}

/** Keep the successful P17 artifact and actual D14 review reachable from DS12.
 * This runs before any GitHub Release write. RC audit files are copied byte for
 * byte; only the binding is generated from the reviewed and tagged Git trees.
 */
export async function qualificationEvidence({ set, reportPath, directory, env = process.env, root = ROOT }) {
  assert.equal(basename(reportPath), 'p17.json', 'P17 report filename differs');
  const runId = runNumber(env.GITHUB_RUN_ID, 'GITHUB_RUN_ID');
  const recordAttempt = runNumber(env.GITHUB_RUN_ATTEMPT, 'GITHUB_RUN_ATTEMPT');
  // A record-only retry must still point to the attempt that produced P17.
  const runAttempt = runNumber(env.P17_RUN_ATTEMPT, 'P17_RUN_ATTEMPT');
  assert(runAttempt <= recordAttempt, 'P17 names a future workflow attempt');
  assert.equal(String(set.run), String(runId), 'DS11 belongs to another workflow run');
  assert.equal(set.commit, env.GITHUB_SHA, 'DS11 belongs to another commit');
  await verifyEvidence(dirname(reportPath), env.P17_MANIFEST_SHA256);
  const report = json(reportPath);
  assert.equal(report.commit, set.commit, 'P17 belongs to another commit');
  assert.equal(report.passed, true, 'P17 did not pass');
  const fields = { p17Evidence: { runId, runAttempt, artifactName: 'release-p17', manifestSha256: env.P17_MANIFEST_SHA256 } };
  const assets = [];
  if (milestoneOf(set.tag.slice(1)) === 'rc') {
    const audit = readRcAudit(set.commit, root);
    const contents = [audit.reportBytes, audit.inputBytes, Buffer.from(JSON.stringify(audit.binding, null, 2) + '\n'), audit.evidenceBytes];
    fields.d14 = {};
    for (const [index, name] of AUDIT_FILES.entries()) {
      const file = join(directory, name), bytes = contents[index];
      writeFileSync(file, bytes);
      fields.d14[name] = sha256(bytes);
      assets.push(file);
    }
  }
  if (milestoneOf(set.tag.slice(1)) === 'final') {
    // The check job authenticates the hosted result before either publisher.
    // Record the same immutable source pointer; do not replace that preflight
    // with a post-publication network check or manufacture a new pass here.
    const { readBurnInReference } = await import('./release-burn-in-final.mjs');
    const retained = readBurnInReference(root), file = join(directory, retained.assetName);
    writeFileSync(file, retained.bytes);
    fields.burnIn = { file: retained.assetName, sha256: retained.sha256,
      rcTag: retained.reference.rcTag, rcCommit: retained.reference.rcCommit,
      runId: retained.reference.runId, runAttempt: retained.reference.runAttempt,
      manifestSha256: retained.reference.manifestSha256 };
    assets.push(file);
  }
  return { fields, assets, report };
}

/** P17's measurement step in one line of the Release's notes (FORMA-188); nothing when P17 took none. */
export function measurementsNotes(report) {
  return report.measurements ? `\n${releaseNotesLine(report.measurements)}\n` : '';
}

export function changelogEntry(changelog, version) {
  // Match the entire version token: a stable tag must not select an alpha entry.
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => {
    const heading = /^## (?:\[([^\]]+)\]|(\S+))(?=\s|$)/.exec(line);
    return heading && (heading[1] ?? heading[2]) === version;
  });
  assert(start >= 0, `missing CHANGELOG entry for ${version}`);
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end++;
  assert(lines.slice(start + 1, end).some(line => line.trim()), `empty CHANGELOG entry for ${version}`);
  return lines.slice(start, end).join('\n').trimEnd();
}

// DS12 names the milestone the tag published, where it went on npm, and every gate that
// still stands before the later milestones, so a reader of the Release sees what the
// pre-release is and what it is not.
export function releaseTitle(version, milestone) {
  return `Forma ${version} (${milestone.name}, ${milestone.plan})`;
}
export function releaseNotes(set, record, entry, milestone) {
  assert.equal(milestone.ready, true, 'a release record requires a ready milestone');
  const standing = milestone.name === 'final' ? 'npm `latest`' : 'pre-release on npm `next`';
  const later = Object.entries(milestone.later).map(([name, gates]) => `- before ${name} (${set.contracts.milestones[name].plan}): ${gates.join('; ')}`);
  const pending = later.length ? `Pending before later milestones:\n${later.join('\n')}` : 'Pending before later milestones: none.';
  const rows = set.packages.map(p => `| ${p.name} | ${p.version} | \`${p.sha256}\` |`).join('\n');
  return `${entry}\n\nMilestone: ${milestone.name} (${milestone.plan}), ${standing}. Every gate of ${milestone.name} and its predecessors is done.\n\n${pending}\n\nCommit: \`${set.commit}\` · run: ${set.run} · CI: ${record.ciRun}\n\n| Package | Version | SHA-256 |\n|---|---|---|\n${rows}\n\nContract versions: \`${JSON.stringify(set.contracts)}\`\n\nTag-event run to record: ${record.elapsedSeconds.toFixed(1)} seconds; target 1800 seconds. Full measurements and DS11 hashes are in the attached JSON.\n${measurementsNotes(record.measurements ?? {})}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  const dir = resolve(process.argv[2]), reportPath = resolve(process.argv[3]);
  const set = json(join(dir, 'release-set.json'));
  const qualification = await qualificationEvidence({ set, reportPath, directory: dir });
  const report = qualification.report;
  assert.equal(set.commit, process.env.GITHUB_SHA);
  assert.equal(report.commit, set.commit);
  assert.equal(report.passed, true, 'P17 did not pass');
  assert(set.packages.length === 7 && set.packages.every(p => /^[a-f0-9]{64}$/.test(p.sha256)), 'incomplete release record');
  const version = set.tag.slice(1);
  const milestone = assertMilestoneReady(set.contracts, version);
  assert.equal(set.milestone?.name, milestone.name, 'packed set names another milestone');
  const started = Date.parse(process.env.RELEASE_STARTED_AT);
  assert(Number.isFinite(started), 'missing original tag-run timestamp');
  let now = new Date();
  const record = { ...set, ...qualification.fields, milestone, ciRun: process.env.CI_RUN, startedAt: new Date(started).toISOString(), recordedAt: now.toISOString(), elapsedSeconds: (now.getTime() - started) / 1000, timingBasis: 'GitHub tag-triggered workflow created_at to release record write (queue included)', measurements: report };
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const entry = changelogEntry(changelog, version);
  record.changelog = entry;
  let notes = releaseNotes(set, record, entry, milestone);
  const recordPath = join(dir, 'release-record.json'), notesPath = join(dir, 'release-notes.md');
  writeFileSync(recordPath, releaseRecordBytes(record)); writeFileSync(notesPath, notes);
  // Existence is queried through an API whose non-404 failures remain failures. Reruns edit
  // their existing release; they never interpret a failed API request as an absent release.
  const response = await fetch(`https://api.github.com/repos/getforma-dev/forma/releases/tags/${encodeURIComponent(set.tag)}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'getforma-release-ci' }, signal: AbortSignal.timeout(20_000) });
  assert(response.ok || response.status === 404, `release status unreadable (${response.status})`);
  if (response.status === 404) run('gh', ['release', 'create', set.tag, '--verify-tag', '--title', releaseTitle(version, milestone), '--notes-file', notesPath, ...(milestone.name === 'final' ? [] : ['--prerelease'])]);
  else run('gh', ['release', 'edit', set.tag, '--title', releaseTitle(version, milestone), '--notes-file', notesPath]);
  // Timestamp after GitHub acknowledged the release write, not before the API call.
  now = new Date();
  record.recordedAt = now.toISOString();
  record.elapsedSeconds = (now.getTime() - started) / 1000;
  record.timingBasis = 'GitHub tag-triggered workflow created_at to acknowledged GitHub Release write (queue included; push ingestion latency not available in Actions)';
  const metadata = await githubReleaseMetadata(set.tag);
  const history = await readSupportHistory({ targetTag: set.tag, currentRecord: record, currentMetadata: metadata, waitForCurrent: true });
  // published_at is immutable across record reruns; recordedAt is not a support clock.
  record.publishedAt = metadata.published_at;
  record.support = history.support;
  record.supportHistory = { sources: history.sources, inventorySha256: history.inventorySha256 };
  const securityPath = join(dir, 'SECURITY.md');
  writeFileSync(securityPath, renderSecurity(readFileSync(join(ROOT, 'SECURITY.md'), 'utf8'), history.support));
  writeFileSync(recordPath, releaseRecordBytes(record));
  notes = notes.replace(/Tag-event run to record: [^;]+;/, `Tag-event run to acknowledged release write: ${record.elapsedSeconds.toFixed(1)} seconds;`);
  writeFileSync(notesPath, notes);
  run('gh', ['release', 'edit', set.tag, '--notes-file', notesPath]);
  run('gh', ['release', 'upload', set.tag, recordPath, reportPath, securityPath, join(dir, 'SHA256SUMS'), ...qualification.assets, '--clobber']);
  assert(run('gh', ['release', 'view', set.tag, '--json', 'assets']).includes('release-record.json'), 'SR2: GitHub Release has no compatibility record');
} catch (error) { console.error(`release-record: ${error.message}`); process.exitCode = 1; }
