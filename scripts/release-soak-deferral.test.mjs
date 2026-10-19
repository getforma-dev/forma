// Finite synthetic Git/API controls. These fixtures are not actual founder,
// audit, publication or soak evidence. The normal R17 test list is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT, json, versionFiles, releaseMilestone } from './release-set.mjs';
import { SOAK_GATE, SOAK_POLICY, SOAK_REFERENCE, SOAK_CONTRACT, readSoakDeferral, validateSoakReference } from './release-soak-deferral.mjs';
import { finalDiffBinding, verifyFinalSoakDeferral } from './release-burn-in-final.mjs';
import { checkReleaseQualification } from './check-release-qualification.mjs';
import { qualificationEvidence, releaseNotes } from './release-record.mjs';
import { recordEvidence } from './release-evidence.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
const contracts = () => {
  const value = json(join(ROOT, 'scripts/release-contracts.json'));
  for (const entry of Object.values(value.milestones)) for (const gate of Object.values(entry.gates)) gate.status = 'done';
  value.milestones.final.gates[SOAK_GATE] = { ...value.milestones.final.gates[SOAK_GATE], status: 'deferred', deferral: { ...SOAK_POLICY } };
  return value;
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'soak-deferral-control-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  git('init', '--quiet'); git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Finite control'); git('config', 'user.email', 'control@example.invalid');
  for (const [path, text] of versionFiles(ROOT, '3.0.0-rc.1')) write(path, text);
  const before = contracts();
  for (const gate of Object.values(before.milestones.final.gates)) { gate.status = 'pending'; delete gate.deferral; }
  write('scripts/release-contracts.json', encode(before));
  write('runtime.js', 'original product\n'); write('README.md', 'original documentation\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic RC (no audit acceptance)');
  const rcCommit = git('rev-parse', 'HEAD'); git('tag', 'v3.0.0-rc.1');
  for (const [path, text] of versionFiles(root, '3.0.0')) write(path, text);
  const finalContracts = contracts(); write('scripts/release-contracts.json', encode(finalContracts));
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic coordinated final delta');
  const reviewedChanges = git('diff', '--name-only', rcCommit, 'HEAD').split('\n').sort().map(path => ({ path, before: git('rev-parse', `${rcCommit}:${path}`), afterSha256: sha(execFileSync('git', ['show', `HEAD:${path}`], { cwd: root })) }));
  const decision = 'SYNTHETIC decision fixture, not authentic founder approval', review = 'SYNTHETIC exact final diff review, not actual acceptance';
  const reference = { contract: SOAK_CONTRACT, finalVersion: '3.0.0', gate: SOAK_GATE, decision: 'L-66-QUOTA', status: 'deferred', activeNanoseconds: '0', requiredActiveNanoseconds: '3600000000000', burnInPassed: false,
    rcTag: 'v3.0.0-rc.1', rcCommit, ds12Sha256: 'a'.repeat(64), p17EvidenceSha256: 'b'.repeat(64), d14EvidenceSha256: 'c'.repeat(64), reviewedChanges,
    decisionEvidence: { content: decision, sha256: sha(decision) }, reviewEvidence: { content: review, sha256: sha(review) } };
  write(SOAK_REFERENCE, encode(reference)); git('add', '.'); git('commit', '--quiet', '-m', 'synthetic immutable deferred reference');
  const commit = git('rev-parse', 'HEAD');
  const authenticated = Object.fromEntries(['ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256'].map(key => [key, reference[key]]));
  return { root, git, write, commit, reference, finalContracts, authenticated };
}
async function recordFixture(t) {
  const f = fixture(t), directory = join(f.root, 'output'), p17 = join(f.root, 'evidence');
  mkdirSync(directory); mkdirSync(p17);
  const reportPath = join(p17, 'p17.json'); writeFileSync(reportPath, encode({ commit: f.commit, passed: true }));
  const manifest = await recordEvidence(p17);
  return { ...f, directory, reportPath,
    set: { tag: 'v3.0.0', commit: f.commit, run: '12345', contracts: f.finalContracts, packages: [] },
    env: { GITHUB_SHA: f.commit, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2', P17_RUN_ATTEMPT: '1', P17_MANIFEST_SHA256: manifest } };
}

test('only explicit final3.0.0 soak deferral is ready; no other pending gate is waived', () => {
  const value = contracts(), result = releaseMilestone(value, '3.0.0');
  assert.equal(result.ready, true); assert.deepEqual(result.deferred, [{ ticket: SOAK_GATE, milestone: 'final', ...SOAK_POLICY }]);
  for (const milestone of ['alpha', 'beta', 'rc', 'final']) {
    const c = structuredClone(value), ticket = Object.keys(c.milestones[milestone].gates).find(key => key !== SOAK_GATE);
    c.milestones[milestone].gates[ticket].status = 'pending'; assert.equal(releaseMilestone(c, '3.0.0').ready, false);
  }
  for (const change of [
    c => { c.version = '3.0.1'; },
    c => { delete c.milestones.final.gates[SOAK_GATE].deferral; },
    c => { c.milestones.final.gates[SOAK_GATE].deferral.reference = 'elsewhere.json'; },
    c => { c.milestones.final.gates[SOAK_GATE].deferral.decision = 'L-66'; },
    c => { c.milestones.final.gates[SOAK_GATE].deferral.finalVersion = '3.0.1'; },
    c => { c.milestones.rc.gates['FORMA-145 audit'].status = 'deferred'; },
    c => { c.milestones.final.gates['FORMA-191'].status = 'deferred'; },
    c => { c.milestones.final.gates[SOAK_GATE].status = 'done'; },
  ]) { const c = structuredClone(value); change(c); assert.throws(() => releaseMilestone(c, '3.0.0')); }
  assert.throws(() => releaseMilestone(value, '3.0.0-rc.1'), /only authorized/);
});

test('reference retains zero credit and actual chain identities; malformed or contradictory evidence refuses', t => {
  const f = fixture(t), retained = readSoakDeferral(f.root, f.finalContracts);
  assert.deepEqual(retained.reference, f.reference); assert.equal(retained.sha256, sha(retained.bytes));
  for (const edit of [
    r => { r.finalVersion = '3.0.1'; }, r => { r.gate = 'FORMA-191'; }, r => { r.status = 'done'; }, r => { r.decision = 'L-66'; },
    r => { r.rcTag = 'v3.0.0-beta.4'; }, r => { r.rcCommit = 'not-a-source'; }, r => { r.activeNanoseconds = '1'; },
    r => { r.requiredActiveNanoseconds = '0'; }, r => { r.burnInPassed = true; }, r => { r.runId = 1; },
    r => { delete r.ds12Sha256; }, r => { r.p17EvidenceSha256 = 'wrong'; }, r => { r.d14EvidenceSha256 = ''; },
    r => { r.decisionEvidence.content += ' changed'; }, r => { r.reviewEvidence.sha256 = 'd'.repeat(64); },
  ]) { const r = structuredClone(f.reference); edit(r); assert.throws(() => validateSoakReference(r)); }
  f.write('docs/release/rc-burn-in.json', '{}'); assert.throws(() => readSoakDeferral(f.root, f.finalContracts), /cannot coexist/);
  rmSync(join(f.root, 'docs/release/rc-burn-in.json')); rmSync(join(f.root, SOAK_REFERENCE));
  assert.throws(() => readSoakDeferral(f.root, f.finalContracts), /ENOENT/);
});

test('canonical final diff and exact committed review remain mandatory for deferred soak', t => {
  const f = fixture(t);
  assert.deepEqual(finalDiffBinding(f.reference, f.commit, f.root), f.reference.reviewedChanges);
  assert.throws(() => finalDiffBinding({ ...f.reference, reviewedChanges: [] }, f.commit, f.root), /committed reference/);
  for (const [path, content] of [['runtime.js', 'changed product'], ['scripts/new-harness.mjs', 'new harness'], ['packages/core/package.json', '{}'], ['README.md', 'unreviewed prose']]) {
    f.write(path, content); f.git('add', '.'); f.git('commit', '--quiet', '-m', `unreviewed ${path}`);
    assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root));
    f.git('reset', '--hard', f.commit);
  }
  const c = structuredClone(f.finalContracts); c.milestones.rc.gates['FORMA-145 audit'].scope += ' waived';
  f.write('scripts/release-contracts.json', encode(c)); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'not a final-only gate delta');
  assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), /beyond final gate completion/);
});

test('preflight authenticates published RC/P17/audit identities, propagates refusal, and always removes scratch', async t => {
  const f = fixture(t); let calls = 0, scratch;
  const authenticate = async args => {
    calls++; scratch = dirname(args.directory); assert(existsSync(scratch));
    assert.equal(args.tag, f.reference.rcTag); assert.equal(args.commit, f.reference.rcCommit); assert.equal(args.checkoutRequired, false);
    return f.authenticated;
  };
  const result = await checkReleaseQualification({ tag: 'v3.0.0', commit: f.commit, root: f.root,
    deferredReader: args => verifyFinalSoakDeferral({ ...args, authenticate }) });
  assert.equal(calls, 1); assert.equal(result.postReleaseSoak.status, 'deferred'); assert.equal(result.postReleaseSoak.activeNanoseconds, '0');
  assert.equal(result.postReleaseSoak.burnInPassed, false); assert.equal(result.postReleaseSoak.publishedRcAuthenticated, true);
  assert(!('burnIn' in result)); assert(!existsSync(scratch));
  for (const message of ['unpublished RC', 'missing accepted D14', 'P17 producer mismatch', 'registry archive mismatch']) {
    await assert.rejects(verifyFinalSoakDeferral({ ...f, authenticate: async args => { scratch = dirname(args.directory); throw Error(message); } }), new RegExp(message));
    assert(!existsSync(scratch));
  }
  for (const key of Object.keys(f.authenticated)) await assert.rejects(verifyFinalSoakDeferral({ ...f, authenticate: async () => ({ ...f.authenticated, [key]: 'f'.repeat(64) }) }), /published RC .* differs/);
  f.git('tag', '-d', f.reference.rcTag);
  await assert.rejects(verifyFinalSoakDeferral({ ...f, authenticate })); assert.equal(calls, 1, 'missing actual RC tag must fail before authentication');
  f.git('tag', f.reference.rcTag, f.commit);
  await assert.rejects(verifyFinalSoakDeferral({ ...f, authenticate }), /RC tag differs/); assert.equal(calls, 1);
});

test('preflight refuses absent references and still-pending audit before any deferral reader', async t => {
  const f = fixture(t); let calls = 0;
  const check = () => checkReleaseQualification({ tag: 'v3.0.0', commit: f.git('rev-parse', 'HEAD'), root: f.root, deferredReader: async () => { calls++; throw Error('must not reach'); } });
  rmSync(join(f.root, SOAK_REFERENCE)); await assert.rejects(check(), /ENOENT/);
  f.write(SOAK_REFERENCE, encode(f.reference));
  const c = structuredClone(f.finalContracts); c.milestones.rc.gates['FORMA-145 audit'].status = 'pending';
  f.write('scripts/release-contracts.json', encode(c)); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'pending audit');
  await assert.rejects(check(), /FORMA-145 audit/); assert.equal(calls, 0);
});

test('DS12 copies exact deferred obligation without inventing a soak run or changing P17 producer attempt', async t => {
  const f = await recordFixture(t), result = await qualificationEvidence(f);
  assert.equal(result.fields.p17Evidence.runAttempt, 1); assert(!('burnIn' in result.fields));
  const value = result.fields.postReleaseSoak;
  assert.equal(value.status, 'deferred'); assert.equal(value.activeNanoseconds, '0'); assert.equal(value.burnInPassed, false);
  assert.equal(value.rcCommit, f.reference.rcCommit); assert.equal(value.sha256, sha(encode(f.reference)));
  assert(!('runId' in value)); assert(!('manifestSha256' in value));
  assert.deepEqual(readFileSync(result.assets[0]), Buffer.from(encode(f.reference)));
  const notes = releaseNotes(f.set, { ciRun: 2, elapsedSeconds: 1 }, 'Final', releaseMilestone(f.finalContracts, '3.0.0'));
  assert.match(notes, /deferred until after this final release under L-66-QUOTA/);
  assert.match(notes, /zero credit and no burn-in pass/); assert.doesNotMatch(notes, /Every gate .* is done/);
  await assert.rejects(qualificationEvidence({ ...f, set: { ...f.set, tag: 'v3.0.1' } }), /gates 3\.0\.0|only authorized/);
  const changed = structuredClone(f.set); changed.contracts.milestones.final.gates[SOAK_GATE].scope += ' changed';
  await assert.rejects(qualificationEvidence({ ...f, set: changed }), /committed source/);
  const reference = structuredClone(f.reference); reference.reviewEvidence.content += ' changed';
  f.write(SOAK_REFERENCE, encode(reference)); await assert.rejects(qualificationEvidence(f), /bytes changed/);
  rmSync(join(f.root, SOAK_REFERENCE)); await assert.rejects(qualificationEvidence(f), /ENOENT/);
});
