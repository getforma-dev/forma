// Bounded synthetic Git/P17 fixtures, not actual qualification or publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, releaseMilestone } from './release-set.mjs';
import { FINAL_WAIVER_GATES, FINAL_WAIVER_POLICY, readFinalWaiver } from './release-final-waiver.mjs';
import { auditInputManifest, AUDIT_FILES } from './release-audit.mjs';
import { checkReleaseQualification } from './check-release-qualification.mjs';
import { qualificationEvidence, releaseNotes } from './release-record.mjs';
import { recordEvidence } from './release-evidence.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
function contracts() {
  const value = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/release-contracts-3.0.0.json')));
  value.version = '3.2.0';
  for (const milestone of Object.values(value.milestones)) for (const gate of Object.values(milestone.gates)) {
    gate.status = 'done'; delete gate.deferral; delete gate.waiver;
  }
  for (const ticket of FINAL_WAIVER_GATES) value.milestones.final.gates[ticket] = { status: 'waived', scope: 'Synthetic finite non-security waiver', waiver: { ...FINAL_WAIVER_POLICY } };
  return value;
}
async function fixture(t, { audit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forma-final-waiver-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  git('init', '--quiet'); git('config', 'user.name', 'Finite control'); git('config', 'user.email', 'control@example.invalid');
  const before = contracts(); before.milestones.rc.gates['FORMA-145 audit'].status = 'pending';
  write('scripts/release-contracts.json', encode(before));
  write(FINAL_WAIVER_POLICY.reference, readFileSync(join(ROOT, FINAL_WAIVER_POLICY.reference)));
  write('runtime.js', 'export const complete = true;\n');
  write('package.json', encode({ name: 'synthetic-stable', version: '3.2.0' }));
  write('CHANGELOG.md', '## [3.2.0]\n\nSynthetic final release fixture.\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic stable audit input');
  const reviewed = git('rev-parse', 'HEAD');
  if (audit) {
    const input = auditInputManifest(reviewed, root), inputBytes = encode(input);
    const raw = ['synthetic author evidence', 'synthetic independent reviewer', 'synthetic accepted result'];
    const report = { contract: 'd14-whole-release-v1', reviewedCommit: reviewed, reviewedTree: input.tree, inputManifestSha256: sha(inputBytes),
      authorModel: { provider: 'test', id: 'author', sessionEvidenceSha256: sha(raw[0]) }, reviewerModel: { provider: 'test', id: 'reviewer', sessionEvidenceSha256: sha(raw[1]) },
      reviewedAt: '2026-10-27T16:40:00Z', accepted: true, findings: [], blockingFindings: [], acceptanceEvidenceSha256: sha(raw[2]) };
    write('docs/release/d14-input-manifest.json', inputBytes); write('docs/release/d14-report.json', encode(report));
    write('docs/release/d14-review-evidence.json', encode({ contract: 'd14-review-evidence-v1', entries: raw.map(content => ({ content, sha256: sha(content) })) }));
  }
  const finalContracts = contracts(); write('scripts/release-contracts.json', encode(finalContracts));
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic accepted review recording');
  const commit = git('rev-parse', 'HEAD'), directory = join(root, 'output'), evidence = join(root, 'evidence'), reportPath = join(evidence, 'p17.json');
  mkdirSync(directory); mkdirSync(evidence); writeFileSync(reportPath, encode({ commit, passed: true }));
  const manifest = await recordEvidence(evidence);
  return { root, git, write, directory, evidence, reportPath, contracts: finalContracts, commit,
    set: { commit, tag: 'v3.2.0', run: '123', contracts: finalContracts, packages: [] },
    env: { GITHUB_SHA: commit, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', P17_RUN_ATTEMPT: '1', P17_MANIFEST_SHA256: manifest } };
}

test('only the two stated final3.2 non-security gates can be waived', () => {
  const value = contracts(), result = releaseMilestone(value, '3.2.0');
  assert.equal(result.ready, true); assert.deepEqual(result.waived.map(row => row.ticket), FINAL_WAIVER_GATES);
  for (const mutate of [
    c => c.milestones.final.gates['FORMA-301 N7'].waiver.sha256 = '0'.repeat(64),
    c => c.milestones.final.gates['FORMA-145 soak'].waiver.decision = 'other',
    c => c.milestones.final.gates['FORMA-301 N7'].status = 'done',
    c => delete c.milestones.final.gates['FORMA-301 N7'],
    c => c.milestones.rc.gates['FORMA-145 audit'] = c.milestones.final.gates['FORMA-301 N7'],
    c => c.milestones.final.gates['FORMA-145 soak'].deferral = {},
  ]) { const changed = structuredClone(value); mutate(changed); assert.throws(() => releaseMilestone(changed, '3.2.0')); }
  for (const version of ['3.0.0', '3.1.0', '3.2.0-rc.4', '3.2.1', '4.0.0']) {
    const changed = structuredClone(value); changed.version = version.split('-')[0];
    assert.throws(() => releaseMilestone(changed, version), /only authorized for final 3\.2\.0/);
  }
  value.milestones.rc.gates['FORMA-145 audit'].status = 'pending';
  assert.equal(releaseMilestone(value, '3.2.0').ready, false, 'independent audit is still required');
});

test('direct final preflight requires the exact committed human decision and final-source audit, no RC reader', async t => {
  const f = await fixture(t); let calls = 0;
  const rejectHosted = () => { calls++; throw Error('published RC must not be requested by this path'); };
  const result = await checkReleaseQualification({ tag: f.set.tag, commit: f.commit, root: f.root, finalReader: rejectHosted, deferredReader: rejectHosted });
  assert.equal(calls, 0); assert.equal(result.audit.rcCommit, f.commit); assert.equal(result.releaseWaiver.status, 'waived');
  assert.equal(result.releaseWaiver.activeSoak.creditedActiveSeconds, 0); assert.equal(result.releaseWaiver.n7TwentyRunCampaign.passed, false);
  assert.equal(result.releaseWaiver.futureSoakRequiredByThisDecision, false); assert.equal('burnIn' in result, false);
});

test('DS12 retains actual final D14 and P17 plus exact waiver asset, never a fabricated burn-in', async t => {
  const f = await fixture(t), result = await qualificationEvidence(f);
  assert.equal(result.fields.p17Evidence.runId, 123); assert.deepEqual(Object.keys(result.fields.d14), AUDIT_FILES);
  assert.equal(result.assets.length, AUDIT_FILES.length + 1);
  assert.deepEqual(readFileSync(result.assets.at(-1)), readFileSync(join(ROOT, FINAL_WAIVER_POLICY.reference)));
  assert.equal(result.fields.releaseWaiver.sha256, FINAL_WAIVER_POLICY.sha256);
  assert.equal(result.fields.releaseWaiver.activeSoak.passed, false); assert.equal('burnIn' in result.fields, false); assert.equal('postReleaseSoak' in result.fields, false);
  const milestone = releaseMilestone(f.contracts, '3.2.0');
  const notes = releaseNotes(f.set, { ciRun: 4, elapsedSeconds: 1 }, '## [3.2.0]\n\nSynthetic.', milestone);
  assert.match(notes, /waives active soak and a new N7/); assert.match(notes, /no future soak promise/); assert.doesNotMatch(notes, /Every gate of final|3,600 active seconds remain required/);
});

test('waiver cannot replace a missing or rejected independent final audit', async t => {
  const missing = await fixture(t, { audit: false });
  await assert.rejects(checkReleaseQualification({ tag: missing.set.tag, commit: missing.commit, root: missing.root }), /ENOENT/);
  await assert.rejects(qualificationEvidence(missing), /ENOENT/);
  const f = await fixture(t), path = join(f.root, 'docs/release/d14-report.json');
  const report = JSON.parse(readFileSync(path)); report.accepted = false; writeFileSync(path, encode(report));
  await assert.rejects(qualificationEvidence(f), /not accepted/);
});

test('product or stable-version drift after final audit remains a hard refusal', async t => {
  for (const path of ['runtime.js', 'package.json']) {
    const f = await fixture(t); f.write(path, path === 'runtime.js' ? 'unreviewed runtime' : encode({ version: '3.2.1' }));
    f.git('add', path); f.git('commit', '--quiet', '-m', 'synthetic unreviewed drift');
    await assert.rejects(checkReleaseQualification({ tag: f.set.tag, commit: f.git('rev-parse', 'HEAD'), root: f.root }), /production\/harness changed/);
  }
});

test('waiver decision content, tracked identity and local regular-file checks fail closed', async t => {
  for (const mode of ['bytes', 'symlink', 'contract', 'commit']) {
    const f = await fixture(t), path = join(f.root, FINAL_WAIVER_POLICY.reference);
    if (mode === 'bytes') writeFileSync(path, readFileSync(path) + '\n');
    if (mode === 'symlink') { const bytes = readFileSync(path); rmSync(path); f.write('decision-copy.json', bytes); symlinkSync(join(f.root, 'decision-copy.json'), path); }
    if (mode === 'contract') f.contracts.milestones.final.gates['FORMA-301 N7'].scope += ' uncommitted';
    assert.throws(() => readFinalWaiver({ root: f.root, contracts: f.contracts, version: '3.2.0', commit: mode === 'commit' ? '0'.repeat(40) : f.commit }));
  }
});

test('waiver cannot accept failed P17 or corrupt retained evidence', async t => {
  const f = await fixture(t); rmSync(join(f.evidence, 'EVIDENCE-SHA256.json'));
  writeFileSync(f.reportPath, encode({ commit: f.commit, passed: false }));
  f.env.P17_MANIFEST_SHA256 = await recordEvidence(f.evidence);
  await assert.rejects(qualificationEvidence(f), /P17 did not pass/);
  writeFileSync(f.reportPath, encode({ commit: f.commit, passed: true }));
  await assert.rejects(qualificationEvidence(f), /tree differs/);
});
