// Finite synthetic Git/API controls. These fixtures are not actual founder,
// audit, publication or soak evidence. The normal R17 test list is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT, json, versionFiles, releaseMilestone } from './release-set.mjs';
import { SOAK_GATE, SOAK_POLICY, SOAK_REFERENCE, SOAK_CONTRACT, readSoakDeferral, validateSoakReference } from './release-soak-deferral.mjs';
import { finalDiffBinding, verifyFinalSoakDeferral } from './release-burn-in-final.mjs';
import { checkReleaseQualification } from './check-release-qualification.mjs';
import { qualificationEvidence, releaseNotes } from './release-record.mjs';
import { recordEvidence } from './release-evidence.mjs';
import { soakDisposition } from './release-soak-deferral.mjs';
import { soakCompletionCli, verifyPostReleaseSoak } from './release-soak-completion.mjs';
import { API } from './release-burn-in-inputs.mjs';
import { CONTRACT, FUZZ_TARGETS, ENGINES, SKEW_CHECKS } from './release-burn-in-report.mjs';
import { hostileIds, fixtureCheckIds } from './release-burn-in-identities.mjs';
import { securityHarnessHashes } from './release-security.mjs';
import { cases, profiles } from '../packages/core/e2e/hostile-widgets/catalogue.mjs';
import { capabilityCases } from '../packages/core/e2e/hostile-widgets/capabilities.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
// The L-66 waiver is frozen to 3.0.0 and must never inherit a newer live contract.
const contracts = () => {
  const value = json(join(ROOT, 'scripts/fixtures/release-contracts-3.0.0.json'));
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
  write('CHANGELOG.md', '# Synthetic changelog\n\n## [3.0.0]\n\nFinal fixture.\n\n## [3.0.0-rc.1]\n\nRC fixture.\n');
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

// The later completion consumer exercises actual API-byte, ZIP, nested-manifest
// and all-workload validators. Only the independently tested RC authenticator is
// injected; the returned archive is real and its bytes are checked below.
async function completionFixture(t) {
  const f = fixture(t); f.git('tag', 'v3.0.0');
  const evidence = mkdtempSync(join(tmpdir(), 'soak-completion-api-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const archiveRoot = join(evidence, 'archive'), raw = join(evidence, 'raw');
  mkdirSync(join(archiveRoot, 'package/dist'), { recursive: true }); mkdirSync(raw);
  const runtime = Buffer.from('synthetic runtime, never release evidence');
  writeFileSync(join(archiveRoot, 'package/dist/formajs-runtime.global.js'), runtime);
  execFileSync('tar', ['-czf', join(evidence, 'core.tgz'), '-C', archiveRoot, 'package']);
  const identities = [['npm', '@getforma/core'], ['npm', '@getforma/compiler'], ['npm', '@getforma/build'], ['npm', '@getforma/create-app'], ['crates', 'forma-ir'], ['crates', 'forma-ir-derive'], ['crates', 'forma-server']];
  const packages = identities.map(([registry, name], i) => ({ registry, name, version: '3.0.0-rc.1', file: i ? `archive-${i}.tgz` : 'core.tgz', bytes: i ? 100 : readFileSync(join(evidence, 'core.tgz')).length, sha256: i ? 'd'.repeat(64) : sha(readFileSync(join(evidence, 'core.tgz'))) }));
  const expected = { rcTag: f.reference.rcTag, sourceCommit: f.reference.rcCommit, ...f.authenticated, packages,
    runtimeSha256: sha(runtime), harnessSha256: sha(execFileSync('git', ['ls-tree', '-r', '-z', f.reference.rcCommit], { cwd: f.root })), hostileCaseIds: hostileIds(), fixtureCheckIds: fixtureCheckIds() };
  const hostile = { schema: 1, passed: true, completeMatrix: true, selection: null, sourceCommit: f.reference.rcCommit,
    sourceClean: true, runtimeSha256: sha(runtime), harnessSources: securityHarnessHashes(), pageErrors: [],
    // Synthetic current-reader evidence, bound to the current harness above.
    profileConcurrency: 2,
    profileRuns: profiles.map((profile, index) => ({ profile, passed: true, cleanupComplete: true, runtimeSha256: sha(runtime),
      origin: `http://127.0.0.1:${4000 + index * 2}`, otherOrigin: `http://127.0.0.1:${4001 + index * 2}`, policy: 'synthetic source-bound policy' })),
    requested: cases().length, requestedCapabilityControls: capabilityCases.length * profiles.length,
    cases: cases().map(({ id }) => ({ id, live: true, executed: 0, outsideReads: 0, unauthorizedRequests: 0 })),
    capabilities: capabilityCases.flatMap(({ id }) => profiles.map(profile => ({ id: `${id}/${profile}` }))),
    observers: profiles.map(profile => ({ profile, executions: 1, outsideReads: 1, response: 200, unexpectedResponse: 404, trustedTypesRefused: true })),
    explicitMount: profiles.flatMap(profile => [{ id: `no-auto/${profile}`, unauthorizedRequests: 0, served: 'raw', injected: 'raw' }, ...['omitted-compiled', 'omitted-reviewed'].map(id => ({ id: `${id}/${profile}`, unauthorizedRequests: 0, live: true, reach: 'confined', failed: 'data-fetch denied: the mount grants no fetch', activations: 0, outsideReads: 0, codes: ['FORMA_E_GRANT_FETCH', 'FORMA_E_GRANT_NAVIGATE'] }))]), catalogueSha256: 'a'.repeat(64) };
  const fixtureProof = { pages: {
    pages: fixtureCheckIds().filter(id => id.startsWith('fixture:')).map(id => { const [, app, ...page] = id.split(':'); return { app, page: page.join(':'), mutations: 0, elements: 1 }; }),
    extras: fixtureCheckIds().filter(id => id.startsWith('extra:')).map(id => id.slice(6)) }, templates: {
    minimal: { island: { errors: [], violations: [], transitions: [7, 8, 0, 1], adoption: { mutations: [], sameNodes: true, sameHost: true } }, static: { executableScripts: 0, modulepreloads: 0, errors: [], violations: [] } },
    dashboard: { interacted: true, pageErrors: [], violations: [], tooltip: { apiTextStayedText: true, violations: { normal: [], hostile: [] }, normal: ['00:00', '23:00'].map(hour => ({ hour, values: ['1', '2'], hiddenOnLeave: true })), hostile: { hour: '<img data-forma-tooltip-probe src="/__forma_tooltip_probe__" onerror="globalThis.__formaTooltipExecuted=true">', values: ['1', '2'], hiddenOnLeave: true } } } } };
  const put = (path, value) => writeFileSync(join(raw, path), typeof value === 'string' ? value : encode(value));
  let time = 0n;
  const rounds = Array.from({ length: 15 }, (_, index) => {
    const dir = `round-${String(index + 1).padStart(3, '0')}`; mkdirSync(join(raw, dir));
    const startedNs = String(time);
    const tasks = [...FUZZ_TARGETS.map(target => `fuzz:${target}`), 'hostile', ...ENGINES.map(engine => `skew:${engine}`), 'fixtures'].map((id, n) => {
      const task = { id, startedNs: String(time), finishedNs: String(time += 60_000_000_000n), complete: true, exitCode: 0, faults: [], activeNanoseconds: id.startsWith('fuzz:') ? '60000000000' : '0' };
      let proof;
      if (id.startsWith('fuzz:')) {
        const target = id.slice(5), log = 'Done 100 runs in 60 second(s)\n';
        Object.assign(task, { executions: 100, fuzzSeconds: 60, seed: index * 4 + n, findings: 0 });
        put(`${dir}/${target}.log`, log); proof = { target, seed: task.seed, logSha256: sha(log) };
      } else if (id === 'hostile') { Object.assign(task, { completeMatrix: true, caseIds: hostileIds() }); proof = hostile; }
      else if (id.startsWith('skew:')) { task.checks = SKEW_CHECKS; proof = { checks: SKEW_CHECKS,
        builds: { A: 'a'.repeat(16), B: 'b'.repeat(16), B2: 'b'.repeat(16), C: 'c'.repeat(16), S: 'd'.repeat(16) },
        requests: [{ instance: 'B', status: 200, cacheControl: 'public, immutable' }, { instance: 'S', status: 404 }] }; }
      else { task.checkIds = fixtureCheckIds(); proof = fixtureProof; }
      put(`${dir}/${id.replaceAll(':', '-')}.json`, proof); task.reportSha256 = sha(encode(proof)); return task;
    });
    const round = { index: index + 1, complete: true, startedNs, finishedNs: String(time), tasks }; put(`${dir}/round.json`, round); return round;
  });
  const report = { contract: CONTRACT, ...expected, harnessCommit: f.reference.rcCommit, complete: true, zeroFaults: true, faults: [], cleanup: { complete: true, remainingOwnedPids: [], failures: [] }, rounds, startedNs: '0', finishedNs: String(time), activeNanoseconds: '3600000000000', orchestrationNanoseconds: String(time - 3_600_000_000_000n) };
  const record = { schema: 1, dryRun: false, tag: 'v3.0.0', commit: f.commit, milestone: { name: 'final' }, packages: packages.map(p => ({ ...p, version: '3.0.0' })), measurements: { passed: true, commit: f.commit }, postReleaseSoak: { ...soakDisposition(f.reference), file: 'post-release-soak-reference.json', sha256: sha(encode(f.reference)) } };
  const runProof = { repository: { full_name: 'getforma-dev/forma' }, head_sha: f.reference.rcCommit, head_branch: f.reference.rcTag, path: '.github/workflows/rc-burn-in.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', id: 246, run_attempt: 1, created_at: '2026-10-20T12:00:00Z', run_started_at: '2026-10-20T12:00:10Z' };
  const jobs = { total_count: 1, jobs: [{ name: 'burn-in', conclusion: 'success', steps: [{ name: 'Continuous packed RC workloads', conclusion: 'success' }] }] };
  let zip, manifest, count = 0;
  async function pack() {
    put('expected.json', expected); put('burn-in.json', report);
    rmSync(join(raw, 'EVIDENCE-SHA256.json'), { force: true }); manifest = await recordEvidence(raw);
    const path = join(evidence, 'artifact.zip');
    execFileSync('python3', ['-c', 'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file(): z.write(f, f.relative_to(p).as_posix())', raw, path]); zip = readFileSync(path);
  }
  await pack();
  const metadata = { id: 123, tag_name: 'v3.0.0', draft: false, prerelease: false, published_at: '2026-10-20T11:00:00Z' };
  let refBytes = Buffer.from(encode(f.reference));
  const fetchImpl = async (url, options) => {
    count++; assert.equal(options.method, undefined, 'reader must never write remotely');
    const bytes = Buffer.from(encode(record));
    const assets = [{ name: 'release-record.json', url: `${API}/releases/assets/1`, digest: `sha256:${sha(bytes)}`, size: bytes.length }, { name: 'post-release-soak-reference.json', url: `${API}/releases/assets/2`, digest: `sha256:${sha(refBytes)}`, size: refBytes.length }];
    if (url === `${API}/releases/tags/v3.0.0`) return Response.json({ assets, ...metadata });
    if (url === assets[0].url) return new Response(bytes);
    if (url === assets[1].url) return new Response(refBytes);
    if (url === `${API}/actions/runs/246/attempts/1`) return Response.json(runProof);
    if (url === `${API}/actions/runs/246/attempts/1/jobs?per_page=100`) return Response.json(jobs);
    if (url === `${API}/actions/runs/246/artifacts?per_page=100`) return Response.json({ total_count: 1, artifacts: [{ id: 4, name: 'rc-burn-in', expired: false, workflow_run: { id: 246, head_sha: f.reference.rcCommit }, digest: `sha256:${sha(zip)}`, size_in_bytes: zip.length, archive_download_url: `${API}/actions/artifacts/4/zip` }] });
    if (url === `${API}/actions/artifacts/4/zip`) return new Response(zip);
    throw Error(`unexpected synthetic API read ${url}`);
  };
  const authenticated = { ...f.authenticated, packages, archives: evidence };
  const authenticate = async args => { assert.equal(args.tag, f.reference.rcTag); assert.equal(args.commit, f.reference.rcCommit); assert.equal(args.checkoutRequired, false); return authenticated; };
  let serial = 0;
  const args = () => ({ root: f.root, tag: 'v3.0.0', commit: f.commit, runId: 246, runAttempt: 1, manifestSha256: manifest, directory: join(evidence, `result-${++serial}`), fetchImpl, authenticate });
  return { ...f, args, record, metadata, authenticated, expected, report, runProof, jobs, pack, raw, evidence,
    reads: () => count, replaceReference: bytes => { refBytes = bytes; } };
}

test('post-final CLI authenticates later hosted raw evidence and writes a separate immutable zero-credit binding', async t => {
  const f = await completionFixture(t), args = f.args(), original = encode(f.record), ref = readFileSync(join(f.root, SOAK_REFERENCE));
  const result = await soakCompletionCli([args.tag, args.commit, String(args.runId), String(args.runAttempt), args.manifestSha256, args.directory], args);
  assert.equal(result.status, 'passed'); assert.equal(result.soak.activeNanoseconds, '3600000000000'); assert.equal(result.soak.rounds, 15);
  assert.equal(result.soak.hostedAttestationVerified, true); assert.deepEqual(result.soak.cleanup, f.report.cleanup);
  assert.equal(result.final.ds12Sha256, sha(original)); assert.equal(result.final.referenceSha256, sha(ref));
  assert.equal(result.final.originalDisposition.activeNanoseconds, '0'); assert.equal(result.final.originalDisposition.burnInPassed, false);
  assert.deepEqual(json(join(args.directory, 'verification.json')), result); assert.equal(readFileSync(join(args.directory, 'final-release-record.json'), 'utf8'), original);
  assert.deepEqual(readFileSync(join(f.root, SOAK_REFERENCE)), ref); assert.equal(encode(f.record), original); assert.equal(f.git('status', '--porcelain'), '');
  await assert.rejects(verifyPostReleaseSoak(args), /must be fresh/);
});

test('post-final consumer refuses false publication, source, deferred disposition or reference assets', async t => {
  const f = await completionFixture(t);
  for (const [object, key, value, message] of [
    [f.record, 'tag', 'v3.0.1', /manifest disagrees/], [f.record, 'commit', 'f'.repeat(40), /commit|P17/i],
    [f.metadata, 'draft', true, /draft/], [f.metadata, 'prerelease', true, /prerelease/],
    [f.record, 'burnIn', { passed: true }, /original deferred/],
    [f.record, 'postReleaseSoak', { ...f.record.postReleaseSoak, activeNanoseconds: '1' }, /deferred binding/],
    [f.metadata, 'assets', [], /requires exactly one/],
    [f.metadata, 'assets', [{ name: 'release-record.json', url: `${API}/releases/assets/1`, size: Buffer.byteLength(encode(f.record)), digest: `sha256:${'f'.repeat(64)}` }], /digest differs/],
  ]) { const old = object[key]; object[key] = value; const args = f.args(); await assert.rejects(verifyPostReleaseSoak(args), message); assert(!existsSync(join(args.directory, 'verification.json'))); assert.equal(json(join(args.directory, 'verification-error.json')).status, 'failed'); if (old === undefined) delete object[key]; else object[key] = old; }
  f.replaceReference(Buffer.from(encode({ ...f.reference, rcCommit: 'f'.repeat(40) })));
  await assert.rejects(verifyPostReleaseSoak(f.args()), /reference differs/);
});

test('later soak must match authenticated RC, successful exact hosted producer and post-publication creation', async t => {
  const f = await completionFixture(t);
  for (const key of ['ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256']) {
    const old = f.authenticated[key]; f.authenticated[key] = 'f'.repeat(64); await assert.rejects(verifyPostReleaseSoak(f.args()), /deferred RC .* differs/); f.authenticated[key] = old;
  }
  for (const [key, value] of [['head_sha', 'f'.repeat(40)], ['head_branch', 'v3.0.0-rc.2'], ['path', '.github/workflows/ci.yml'], ['conclusion', 'failure'], ['created_at', '2026-10-20T10:59:59Z'], ['run_started_at', '2026-10-20T10:59:59Z'], ['created_at', 'invalid']]) {
    const old = f.runProof[key]; f.runProof[key] = value; await assert.rejects(verifyPostReleaseSoak(f.args())); f.runProof[key] = old;
  }
  f.jobs.jobs[0].steps[0].conclusion = 'failure'; await assert.rejects(verifyPostReleaseSoak(f.args()), /workload step/);
  f.jobs.jobs[0].steps[0].conclusion = 'success'; await assert.rejects(verifyPostReleaseSoak({ ...f.args(), manifestSha256: 'f'.repeat(64) }), /manifest differs/);
  await assert.rejects(verifyPostReleaseSoak({ ...f.args(), authenticate: async () => { throw Error('actual published RC authentication refused'); } }), /RC authentication refused/);
});

test('post-final consumer revalidates complete active work, zero faults, all raw cases and cleanup', async t => {
  const f = await completionFixture(t);
  for (const [object, key, value, message] of [[f.report, 'activeNanoseconds', '3599000000000', /active duration/], [f.report, 'zeroFaults', false, /fault flag/], [f.report, 'complete', false, /incomplete campaign/], [f.report.cleanup, 'remainingOwnedPids', [123], /cleanup/], [f.expected, 'd14EvidenceSha256', 'f'.repeat(64), /strictly equal/]]) {
    const old = object[key]; object[key] = value; await f.pack(); await assert.rejects(verifyPostReleaseSoak(f.args()), message); object[key] = old;
  }
  // Self-consistent shortened work still cannot earn an hour.
  const task = f.report.rounds.at(-1).tasks[0]; task.fuzzSeconds = 59; task.activeNanoseconds = '59000000000';
  f.report.activeNanoseconds = '3599000000000'; f.report.orchestrationNanoseconds = String(BigInt(f.report.orchestrationNanoseconds) + 1_000_000_000n);
  await f.pack(); await assert.rejects(verifyPostReleaseSoak(f.args()), /less than 3600/);
  task.fuzzSeconds = 60; task.activeNanoseconds = '60000000000'; f.report.activeNanoseconds = '3600000000000'; f.report.orchestrationNanoseconds = String(BigInt(f.report.orchestrationNanoseconds) - 1_000_000_000n);
  // An authenticated nested inventory cannot replace per-task semantic proof.
  const raw = join(f.raw, 'round-001/fixtures.json'), proof = json(raw); proof.templates.dashboard.interacted = false;
  writeFileSync(raw, encode(proof)); f.report.rounds[0].tasks.at(-1).reportSha256 = sha(encode(proof));
  writeFileSync(join(f.raw, 'round-001/round.json'), encode(f.report.rounds[0]));
  await f.pack(); await assert.rejects(verifyPostReleaseSoak(f.args()), /strictly equal/);
});

test('completion requires exact clean final tag and fresh external output before any API read', async t => {
  const f = await completionFixture(t);
  for (const patch of [{ tag: 'v3.0.1' }, { commit: f.reference.rcCommit }, { runId: 0 }, { runAttempt: 0 }, { manifestSha256: 'missing' }, { directory: join(f.root, 'output') }, { directory: 'relative' }]) await assert.rejects(verifyPostReleaseSoak({ ...f.args(), ...patch }));
  const alias = join(f.evidence, 'checkout-link'); symlinkSync(f.root, alias, 'dir');
  await assert.rejects(verifyPostReleaseSoak({ ...f.args(), directory: join(alias, 'output') }), /outside/);
  f.write('runtime.js', 'dirty'); await assert.rejects(verifyPostReleaseSoak(f.args()), /source must be clean/); f.git('checkout', '--', 'runtime.js');
  f.git('tag', '-d', 'v3.0.0'); f.git('tag', 'v3.0.0', f.reference.rcCommit); await assert.rejects(verifyPostReleaseSoak(f.args()), /final tag differs/);
  await assert.rejects(soakCompletionCli(['v3.0.0', f.commit, '1junk', '1', 'a'.repeat(64), join(f.evidence, 'unused')]), /usage/);
  assert.equal(f.reads(), 0);
});
