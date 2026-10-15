#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, save, run, ROOT } from './release-set.mjs';

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  const dir = resolve(process.argv[2]), reportPath = resolve(process.argv[3]);
  const set = json(join(dir, 'release-set.json')), report = json(reportPath);
  assert.equal(set.commit, process.env.GITHUB_SHA);
  assert.equal(report.commit, set.commit);
  assert.equal(report.passed, true, 'P17 did not pass');
  assert(set.packages.length === 7 && set.packages.every(p => /^[a-f0-9]{64}$/.test(p.sha256)), 'incomplete release record');
  const started = Date.parse(process.env.RELEASE_STARTED_AT);
  assert(Number.isFinite(started), 'missing original tag-run timestamp');
  let now = new Date();
  const record = { ...set, ciRun: process.env.CI_RUN, startedAt: new Date(started).toISOString(), recordedAt: now.toISOString(), elapsedSeconds: (now.getTime() - started) / 1000, timingBasis: 'GitHub tag-triggered workflow created_at to release record write (queue included)', measurements: report };
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const version = set.tag.slice(1);
  const entry = changelogEntry(changelog, version);
  record.changelog = entry;
  const rows = set.packages.map(p => `| ${p.name} | ${p.version} | \`${p.sha256}\` |`).join('\n');
  let notes = `${entry}\n\nCommit: \`${set.commit}\` · run: ${set.run} · CI: ${record.ciRun}\n\n| Package | Version | SHA-256 |\n|---|---|---|\n${rows}\n\nContract versions: \`${JSON.stringify(set.contracts)}\`\n\nTag-event run to record: ${record.elapsedSeconds.toFixed(1)} seconds; target 1800 seconds. Full measurements and DS11 hashes are in the attached JSON.\n`;
  const recordPath = join(dir, 'release-record.json'), notesPath = join(dir, 'release-notes.md');
  save(recordPath, record); writeFileSync(notesPath, notes);
  // Existence is queried through an API whose non-404 failures remain failures. Reruns edit
  // their existing release; they never interpret a failed API request as an absent release.
  const response = await fetch(`https://api.github.com/repos/getforma-dev/forma/releases/tags/${encodeURIComponent(set.tag)}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'getforma-release-ci' }, signal: AbortSignal.timeout(20_000) });
  assert(response.ok || response.status === 404, `release status unreadable (${response.status})`);
  if (response.status === 404) run('gh', ['release', 'create', set.tag, '--verify-tag', '--title', `Forma ${version}`, '--notes-file', notesPath, ...(version.includes('-') ? ['--prerelease'] : [])]);
  else run('gh', ['release', 'edit', set.tag, '--notes-file', notesPath]);
  // Timestamp after GitHub acknowledged the release write, not before the API call.
  now = new Date();
  record.recordedAt = now.toISOString();
  record.elapsedSeconds = (now.getTime() - started) / 1000;
  record.timingBasis = 'GitHub tag-triggered workflow created_at to acknowledged GitHub Release write (queue included; push ingestion latency not available in Actions)';
  save(recordPath, record);
  notes = notes.replace(/Tag-event run to record: [^;]+;/, `Tag-event run to acknowledged release write: ${record.elapsedSeconds.toFixed(1)} seconds;`);
  writeFileSync(notesPath, notes);
  run('gh', ['release', 'edit', set.tag, '--notes-file', notesPath]);
  run('gh', ['release', 'upload', set.tag, recordPath, reportPath, join(dir, 'SHA256SUMS'), '--clobber']);
  assert(run('gh', ['release', 'view', set.tag, '--json', 'assets']).includes('release-record.json'), 'SR2: GitHub Release has no compatibility record');
} catch (error) { console.error(`release-record: ${error.message}`); process.exitCode = 1; }
