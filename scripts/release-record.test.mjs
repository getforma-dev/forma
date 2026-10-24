import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { changelogEntry, measurementsNotes, releaseNotes, releaseTitle, qualificationEvidence } from './release-record.mjs';
import { ROOT, json, releaseMilestone } from './release-set.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { recordEvidence } from './release-evidence.mjs';
import { auditInputManifest, AUDIT_FILES } from './release-audit.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
async function evidenceFixture(t, { rc = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forma-record-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet'); git('config', 'user.name', 'Finite control'); git('config', 'user.email', 'control@example.invalid');
  writeFileSync(join(root, 'runtime.js'), 'export const actual = true;\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'review input');
  const reviewed = git('rev-parse', 'HEAD');
  if (rc) {
    const input = auditInputManifest(reviewed, root), inputBytes = encode(input);
    const raw = ['finite author model evidence', 'finite different model review', 'finite accepted review'];
    const report = { contract: 'd14-whole-release-v1', reviewedCommit: reviewed, reviewedTree: input.tree, inputManifestSha256: digest(inputBytes),
      authorModel: { provider: 'test', id: 'author', sessionEvidenceSha256: digest(raw[0]) },
      reviewerModel: { provider: 'test', id: 'reviewer', sessionEvidenceSha256: digest(raw[1]) },
      reviewedAt: '2026-10-16T10:00:00Z', accepted: true, findings: [], blockingFindings: [], acceptanceEvidenceSha256: digest(raw[2]) };
    mkdirSync(join(root, 'docs/release'), { recursive: true });
    writeFileSync(join(root, 'docs/release/d14-input-manifest.json'), inputBytes);
    writeFileSync(join(root, 'docs/release/d14-report.json'), encode(report));
    writeFileSync(join(root, 'docs/release/d14-review-evidence.json'), encode({ contract: 'd14-review-evidence-v1', entries: raw.map(content => ({ content, sha256: digest(content) })) }));
    git('add', '.'); git('commit', '--quiet', '-m', 'record accepted review');
  }
  const commit = git('rev-parse', 'HEAD'), directory = join(root, 'output'), p17 = join(root, 'evidence');
  mkdirSync(directory); mkdirSync(join(p17, 'raw'), { recursive: true });
  const reportPath = join(p17, 'p17.json'), report = { commit, passed: true, measurements: { full: 'retained' } };
  writeFileSync(reportPath, encode(report)); writeFileSync(join(p17, 'raw/trace.json'), '[1,2,3]\n');
  const manifestSha256 = await recordEvidence(p17);
  const set = { commit, run: '12345', tag: rc ? 'v3.0.0-rc.1' : 'v3.0.0-beta.1' };
  const env = { GITHUB_SHA: commit, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2', P17_RUN_ATTEMPT: '2', P17_MANIFEST_SHA256: manifestSha256 };
  return { root, directory, reportPath, set, env, report, p17, git };
}

test('DS12 names the actual authenticated nested P17 artifact without requiring D14 for beta', async t => {
  const f = await evidenceFixture(t), result = await qualificationEvidence(f);
  assert.deepEqual(result.fields, { p17Evidence: { runId: 12345, runAttempt: 2, artifactName: 'release-p17', manifestSha256: f.env.P17_MANIFEST_SHA256 } });
  assert.deepEqual(result.assets, []); assert.deepEqual(result.report, f.report);
  const retry = await qualificationEvidence({ ...f, env: { ...f.env, GITHUB_RUN_ATTEMPT: '3' } });
  assert.equal(retry.fields.p17Evidence.runAttempt, 2, 'record-only retry preserves the successful verifier attempt');
  writeFileSync(join(f.p17, 'raw/trace.json'), 'changed actual raw evidence');
  await assert.rejects(qualificationEvidence(f), /tree differs/);
});

test('DS12 refuses absent, malformed or mismatched workflow and manifest identities', async t => {
  const f = await evidenceFixture(t);
  for (const env of [
    { ...f.env, GITHUB_RUN_ID: '12346' }, { ...f.env, GITHUB_RUN_ID: '012345' },
    { ...f.env, GITHUB_RUN_ATTEMPT: '0' }, { ...f.env, GITHUB_RUN_ATTEMPT: undefined },
    { ...f.env, GITHUB_RUN_ATTEMPT: '9007199254740992' }, { ...f.env, GITHUB_SHA: 'a'.repeat(40) },
    { ...f.env, P17_RUN_ATTEMPT: undefined }, { ...f.env, P17_RUN_ATTEMPT: '0' }, { ...f.env, P17_RUN_ATTEMPT: '3' },
    { ...f.env, P17_MANIFEST_SHA256: undefined }, { ...f.env, P17_MANIFEST_SHA256: 'a'.repeat(64) },
  ]) await assert.rejects(qualificationEvidence({ ...f, env }));
});

test('RC emits all four actual D14 assets and hashes their exact bytes', async t => {
  const f = await evidenceFixture(t, { rc: true }), result = await qualificationEvidence(f);
  assert.deepEqual(Object.keys(result.fields.d14), AUDIT_FILES);
  assert.deepEqual(result.assets, AUDIT_FILES.map(name => join(f.directory, name)));
  for (const [name, hash] of Object.entries(result.fields.d14)) assert.equal(digest(readFileSync(join(f.directory, name))), hash);
  for (const name of AUDIT_FILES.filter(name => name !== 'd14-rc-binding.json')) {
    assert.deepEqual(readFileSync(join(f.directory, name)), readFileSync(join(f.root, 'docs/release', name)));
  }
  assert.equal(json(join(f.directory, 'd14-rc-binding.json')).rcCommit, f.set.commit);
  const reportFile = join(f.root, 'docs/release/d14-report.json'), report = json(reportFile);
  report.accepted = false; writeFileSync(reportFile, encode(report));
  await assert.rejects(qualificationEvidence(f), /not accepted/);
});

test('RC cannot record without a real audit, nor with changed production after review', async t => {
  const missing = await evidenceFixture(t);
  await assert.rejects(qualificationEvidence({ ...missing, set: { ...missing.set, tag: 'v3.0.0-rc.1' } }), /ENOENT/);
  const f = await evidenceFixture(t, { rc: true });
  writeFileSync(join(f.root, 'runtime.js'), 'changed production');
  f.git('add', 'runtime.js'); f.git('commit', '--quiet', '-m', 'unreviewed product');
  const commit = f.git('rev-parse', 'HEAD');
  // Rebind the authentic P17 report/manifest to the new commit: D14 must still fail.
  rmSync(join(f.p17, 'EVIDENCE-SHA256.json'));
  writeFileSync(f.reportPath, encode({ ...f.report, commit }));
  const manifestSha256 = await recordEvidence(f.p17);
  await assert.rejects(qualificationEvidence({ ...f, set: { ...f.set, commit }, env: { ...f.env, GITHUB_SHA: commit, P17_MANIFEST_SHA256: manifestSha256 } }), /production\/harness changed/);
});

// Historical 3.0 release-note/waiver behavior is independent of today's contract status.
for (const deferredInput of [false, true]) test(`the GitHub Release names the milestone, channel and later gates (deferred input: ${deferredInput})`, () => {
  const contracts = json(join(ROOT, 'scripts/fixtures/release-contracts-3.0.0.json'));
  if (deferredInput) {
    const soak = contracts.milestones.final.gates['FORMA-145 soak'];
    soak.status = 'deferred';
    soak.deferral = { decision: 'L-66-QUOTA', finalVersion: '3.0.0', reference: 'docs/release/post-release-soak.json' };
  }
  // Reconstruct an alpha fixture, not a contradictory snapshot of live final progress.
  for (const [name, milestone] of Object.entries(contracts.milestones)) {
    for (const gate of Object.values(milestone.gates)) {
      gate.status = name === 'alpha' ? 'done' : 'pending';
      delete gate.deferral;
    }
  }
  // Keep the fixture's later gates open independently of live release progress.
  contracts.milestones.beta.gates['FORMA-188 fixture applications'].status = 'pending';
  contracts.milestones.rc.gates['FORMA-145 audit'].status = 'pending';
  contracts.milestones.final.gates['FORMA-191'].status = 'pending';
  const milestone = releaseMilestone(contracts, '3.0.0-alpha.1');
  const set = { tag: 'v3.0.0-alpha.1', commit: 'a'.repeat(40), run: 1, contracts, milestone, packages: [{ name: 'forma-ir', version: '3.0.0-alpha.1', sha256: 'b'.repeat(64) }] };
  const notes = releaseNotes(set, { ciRun: 2, elapsedSeconds: 12.34 }, '## [3.0.0-alpha.1]\n\nFirst alpha.', milestone);
  assert.match(notes, /^## \[3\.0\.0-alpha\.1\]\n\nFirst alpha\.\n\nMilestone: alpha \(M2\), pre-release on npm `next`\./);
  assert.match(notes, /\n- before beta \(M3\): .*FORMA-188 fixture applications: the three fixture applications in P17/);
  assert.match(notes, /\n- before rc \(M4\): .*FORMA-145 audit/);
  assert.match(notes, /\n- before final \(M5\): .*FORMA-191: the per-release measurements in P17/);
  assert.match(notes, /\| forma-ir \| 3\.0\.0-alpha\.1 \| `b{64}` \|/);
  assert.match(notes, /Tag-event run to record: 12\.3 seconds/);
  const measured = releaseNotes(set, { ciRun: 2, elapsedSeconds: 12.34, measurements: { measurements: {
    p17: { seconds: 301.4, limitSeconds: 1800 },
    n2: [{ app: 'ledger', route: '/household', formaGzip: 25366, limit: 27500 }],
    machine: { runner: 'Linux X64', cpus: 4, node: 'v24.22.0' },
  } } }, '## [3.0.0-alpha.1]\n\nFirst alpha.', milestone);
  assert.match(measured, /Milestone: alpha \(M2\)/);
  assert.match(measured, /P17 ran 301 s of 1,800 s; the most Forma code on any fixture route is 25,366 B of 27,500 B/);
  assert.equal(releaseTitle('3.0.0-alpha.1', milestone), 'Forma 3.0.0-alpha.1 (alpha, M2)');
  const betaContracts = structuredClone(contracts);
  for (const gate of Object.values(betaContracts.milestones.beta.gates)) gate.status = 'done';
  const beta = releaseMilestone(betaContracts, '3.0.0-beta.1');
  const betaNotes = releaseNotes({ ...set, tag: 'v3.0.0-beta.1', contracts: betaContracts, milestone: beta,
    packages: [{ ...set.packages[0], version: '3.0.0-beta.1' }],
  }, { ciRun: 2, elapsedSeconds: 1 }, '## [3.0.0-beta.1]\n\nBeta.', beta);
  assert.match(betaNotes, /Milestone: beta \(M3\), pre-release on npm `next`\./);
  assert.doesNotMatch(betaNotes, /\n- before beta \(M3\):/);
  assert.match(betaNotes, /\n- before rc \(M4\): .*FORMA-145 audit/);
  assert.match(betaNotes, /\n- before final \(M5\): .*FORMA-191: the per-release measurements in P17/);
  const done = structuredClone(contracts);
  for (const m of Object.values(done.milestones)) for (const gate of Object.values(m.gates)) gate.status = 'done';
  const final = releaseMilestone(done, '3.0.0');
  const finalNotes = releaseNotes({ ...set, tag: 'v3.0.0', contracts: done, milestone: final }, { ciRun: 2, elapsedSeconds: 1 }, '## [3.0.0]\n\nFinal.', final);
  assert.match(finalNotes, /Milestone: final \(M5\), npm `latest`\./);
  assert.match(finalNotes, /Pending before later milestones: none\./);
  assert.equal(releaseTitle('3.0.0', final), 'Forma 3.0.0 (final, M5)');
  assert.throws(() => releaseNotes(set, { ciRun: 2, elapsedSeconds: 1 }, 'x', releaseMilestone(contracts, '3.0.0-beta.1')), /ready milestone/);
});

test('release notes retain paragraphs, bullets and subheadings up to the next release', () => {
  const entry = '## [3.0.0] - 2026-10-15\n\nNew wire format.\n\n### Upgrading\n\n- Recompile IR.\n- Keep the packages aligned.\n\nSecond paragraph.';
  const source = `# Changelog\n\n## [Unreleased]\n\nFuture work.\n\n${entry}\n\n## [2.1.0]\n\nOld changes.\n`;
  assert.equal(changelogEntry(source, '3.0.0'), entry);
  assert.equal(changelogEntry(source.replaceAll('\n', '\r\n'), '3.0.0'), entry);
});

test('last release extends to true EOF and an unbracketed version is accepted', () => {
  const entry = '## 3.0.0-alpha.1 - 2026-10-15\n\nFirst preview.\n\n### Changes\n\n- Complete final paragraph.';
  assert.equal(changelogEntry(`# Changelog\n\n${entry}`, '3.0.0-alpha.1'), entry);
});

test('stable tags cannot select prereleases or other version prefixes', () => {
  const source = '## [3.0.0-alpha.1]\n\nPreview.\n\n## 3.0.01\n\nDifferent version.\n';
  assert.throws(() => changelogEntry(source, '3.0.0'), /missing CHANGELOG/);
  assert.throws(() => changelogEntry('## [3.0.0]\n\n## [2.1.0]\nOld.', '3.0.0'), /empty CHANGELOG/);
});

test('the Release notes carry one line of P17\'s measurements when it took them, and nothing otherwise', () => {
  assert.equal(measurementsNotes({ passed: true }), '');
  const machine = { runner: 'Linux X64', cpus: 4, node: 'v24.22.0' };
  const line = measurementsNotes({ measurements: { p17: { seconds: 301.4, limitSeconds: 1800 }, n2: [{ app: 'ledger', route: '/household', formaGzip: 25366, limit: 25500 }], machine } });
  assert.match(line, /^\nP17 ran 301 s of 1,800 s; the most Forma code on any fixture route is 25,366 B of 25,500 B gzip -9 \(ledger \/household\)/);
});

test('final DS12 retains the exact reviewed hosted burn-in pointer, never inventing a run', async t => {
  const f = await evidenceFixture(t), content = 'finite independent final diff review';
  const reference = {contract:'rc-burn-in-reference-v1',rcTag:'v3.0.0-rc.1',rcCommit:'a'.repeat(40),runId:42,runAttempt:1,manifestSha256:'b'.repeat(64),finalVersion:'3.0.0',reviewEvidence:{content,sha256:digest(content)},reviewedChanges:[]};
  mkdirSync(join(f.root,'docs/release'),{recursive:true});
  const bytes=encode(reference);writeFileSync(join(f.root,'docs/release/rc-burn-in.json'),bytes);
  const result=await qualificationEvidence({...f,set:{...f.set,tag:'v3.0.0'}});
  assert.equal(result.fields.burnIn.sha256,digest(bytes));assert.deepEqual(readFileSync(result.assets[0]),Buffer.from(bytes));
  reference.runAttempt=0;writeFileSync(join(f.root,'docs/release/rc-burn-in.json'),encode(reference));
  await assert.rejects(qualificationEvidence({...f,set:{...f.set,tag:'v3.0.0'}}));
});

test('DS12 byte limit applies to the exact pretty UTF-8 bytes written, including newline', async () => {
  const { releaseRecordBytes } = await import('./release-record.mjs');
  const record = { text: 'é😀' }, bytes = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  assert.deepEqual(releaseRecordBytes(record, bytes.length), bytes);
  assert.throws(() => releaseRecordBytes(record, bytes.length - 1), /transport byte limit/);
});
