// Offline finite controls. Synthetic reports/API/review text never certify a soak.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadPayloadPlaywright } from './release-burn-in.mjs';
import { ROOT, json } from './release-set.mjs';
import { recordEvidence } from './release-evidence.mjs';
import { soakDisposition } from './release-soak-deferral.mjs';
import { verifyPostReleaseSoak } from './release-soak-completion.mjs';
import { verifyPostReleaseSoakV2 } from './release-soak-completion-v2.mjs';
import { API, verifyRun } from './release-burn-in-inputs.mjs';
import { CONTRACT, FUZZ_TARGETS, ENGINES, SKEW_CHECKS } from './release-burn-in-report.mjs';
import { FINAL_COMMIT, RC_COMMIT, RC_TAG, WORKFLOW, sourceStatus, requirePayload, workerContext, donorDiff, validateDonorReview } from './release-soak-context-v2.mjs';
const encode = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function checkouts(t) {
  const directory = mkdtempSync(join(tmpdir(), 'soak-v2-controls-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const clone = (name, commit) => {
    const path = join(directory, name);
    git(ROOT, 'clone', '--shared', '--no-checkout', '--quiet', ROOT, path);
    git(path, 'checkout', '--quiet', '--detach', commit); return path;
  };
  const root = clone('final', FINAL_COMMIT), payloadRoot = clone('payload', RC_COMMIT), donorRoot = clone('donor', FINAL_COMMIT);
  git(donorRoot, 'config', 'user.name', 'Synthetic control'); git(donorRoot, 'config', 'user.email', 'control@example.invalid');
  writeFileSync(join(donorRoot, 'synthetic-orchestration.txt'), 'finite control only\n');
  git(donorRoot, 'add', 'synthetic-orchestration.txt'); git(donorRoot, 'commit', '--quiet', '-m', 'synthetic donor (never actual approval)');
  const donorCommit = git(donorRoot, 'rev-parse', 'HEAD'), content = 'SYNTHETIC independent-review fixture; not actual acceptance';
  const pin = { contract: 'post-final-soak-donor-review-v2', baseCommit: FINAL_COMMIT, donorCommit, diffSha256: donorDiff(donorRoot, donorCommit), reviewEvidence: { content, sha256: sha(content) } };
  const env = { PYTHONDONTWRITEBYTECODE: '1', GITHUB_REPOSITORY: 'getforma-dev/forma', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/synthetic-donor', GITHUB_SHA: donorCommit, GITHUB_WORKFLOW_SHA: donorCommit, GITHUB_WORKFLOW_REF: `getforma-dev/forma/${WORKFLOW}@refs/heads/synthetic-donor`, GITHUB_RUN_ID: '246', GITHUB_RUN_ATTEMPT: '1' };
  const context = workerContext({ payloadRoot, donorRoot, env });
  const reference = json(join(root, 'docs/release/post-release-soak.json'));
  const authenticated = Object.fromEntries(['ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256'].map(k => [k, reference[k]]));
  return { root, payloadRoot, donorRoot, directory, pin, context, env, reference, authenticated, commit: FINAL_COMMIT };
}
async function completionFixture(t, f) {
  // Synthetic evidence describes the pinned RC workload, not today's added checks.
  const { hostileIds, fixtureCheckIds } = await import(pathToFileURL(join(f.payloadRoot, 'scripts/release-burn-in-identities.mjs')).href);
  const fixtureIds = fixtureCheckIds(join(f.payloadRoot, 'e2e/fixtures/apps'));
  // The RC raw validators compare the report with the pinned RC checkout's harness, so the synthetic report takes its hashes from there, not from the live tree.
  const { securityHarnessHashes } = await import(pathToFileURL(join(f.payloadRoot, 'scripts/release-security.mjs')).href);
  // Its cases, capability controls and profiles too: the RC validator compares them with the RC catalogue.
  const { cases, profiles } = await import(pathToFileURL(join(f.payloadRoot, 'packages/core/e2e/hostile-widgets/catalogue.mjs')).href);
  const { capabilityCases } = await import(pathToFileURL(join(f.payloadRoot, 'packages/core/e2e/hostile-widgets/capabilities.mjs')).href);
  const evidence = mkdtempSync(join(tmpdir(), 'soak-completion-api-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const archiveRoot = join(evidence, 'archive'), raw = join(evidence, 'raw');
  mkdirSync(join(archiveRoot, 'package/dist'), { recursive: true }); mkdirSync(raw);
  const runtime = Buffer.from('synthetic runtime, never release evidence');
  writeFileSync(join(archiveRoot, 'package/dist/formajs-runtime.global.js'), runtime);
  execFileSync('tar', ['-czf', join(evidence, 'core.tgz'), '-C', archiveRoot, 'package']);
  const identities = [['npm', '@getforma/core'], ['npm', '@getforma/compiler'], ['npm', '@getforma/build'], ['npm', '@getforma/create-app'], ['crates', 'forma-ir'], ['crates', 'forma-ir-derive'], ['crates', 'forma-server']];
  const packages = identities.map(([registry, name], i) => ({ registry, name, version: RC_TAG.slice(1), file: i ? `archive-${i}.tgz` : 'core.tgz', bytes: i ? 100 : readFileSync(join(evidence, 'core.tgz')).length, sha256: i ? 'd'.repeat(64) : sha(readFileSync(join(evidence, 'core.tgz'))) }));
  const expected = { rcTag: f.reference.rcTag, sourceCommit: f.reference.rcCommit, ...f.authenticated, packages,
    runtimeSha256: sha(runtime), harnessSha256: sha(execFileSync('git', ['ls-tree', '-r', '-z', f.reference.rcCommit], { cwd: f.root })), hostileCaseIds: hostileIds(), fixtureCheckIds: fixtureIds };
  const hostile = { schema: 1, passed: true, completeMatrix: true, selection: null, sourceCommit: f.reference.rcCommit,
    sourceClean: true, runtimeSha256: sha(runtime), harnessSources: securityHarnessHashes(), pageErrors: [],
    requested: cases().length, requestedCapabilityControls: capabilityCases.length * profiles.length,
    cases: cases().map(({ id }) => ({ id, live: true, executed: 0, outsideReads: 0, unauthorizedRequests: 0 })),
    capabilities: capabilityCases.flatMap(({ id }) => profiles.map(profile => ({ id: `${id}/${profile}` }))),
    observers: profiles.map(profile => ({ profile, executions: 1, outsideReads: 1, response: 200, unexpectedResponse: 404, trustedTypesRefused: true })),
    explicitMount: profiles.flatMap(profile => [{ id: `no-auto/${profile}`, unauthorizedRequests: 0, served: 'raw', injected: 'raw' }, ...['omitted-compiled', 'omitted-reviewed'].map(id => ({ id: `${id}/${profile}`, unauthorizedRequests: 0, live: true, reach: 'confined', failed: 'data-fetch denied: the mount grants no fetch', activations: 0, outsideReads: 0, codes: ['FORMA_E_GRANT_FETCH', 'FORMA_E_GRANT_NAVIGATE'] }))]), catalogueSha256: 'a'.repeat(64) };
  const fixtureProof = { pages: {
    pages: fixtureIds.filter(id => id.startsWith('fixture:')).map(id => { const [, app, ...page] = id.split(':'); return { app, page: page.join(':'), mutations: 0, elements: 1 }; }),
    extras: fixtureIds.filter(id => id.startsWith('extra:')).map(id => id.slice(6)) }, templates: {
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
      else { task.checkIds = fixtureIds; proof = fixtureProof; }
      put(`${dir}/${id.replaceAll(':', '-')}.json`, proof); task.reportSha256 = sha(encode(proof)); return task;
    });
    const round = { index: index + 1, complete: true, startedNs, finishedNs: String(time), tasks }; put(`${dir}/round.json`, round); return round;
  });
  const report = { contract: CONTRACT, ...expected, harnessCommit: f.reference.rcCommit, complete: true, zeroFaults: true, faults: [], cleanup: { complete: true, remainingOwnedPids: [], failures: [] }, rounds, startedNs: '0', finishedNs: String(time), activeNanoseconds: '3600000000000', orchestrationNanoseconds: String(time - 3_600_000_000_000n) };
  const record = { schema: 1, dryRun: false, tag: 'v3.0.0', commit: f.commit, milestone: { name: 'final' }, packages: packages.map(p => ({ ...p, version: '3.0.0' })), measurements: { passed: true, commit: f.commit }, postReleaseSoak: { ...soakDisposition(f.reference), file: 'post-release-soak-reference.json', sha256: sha(readFileSync(join(f.root, 'docs/release/post-release-soak.json'))) } };
  const runProof = { repository: { full_name: 'getforma-dev/forma' }, head_sha: f.pin.donorCommit, head_branch: 'synthetic-donor', path: WORKFLOW, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', id: 246, run_attempt: 1, created_at: '2026-10-20T12:00:00Z', run_started_at: '2026-10-20T12:00:10Z' };
  const jobs = { total_count: 1, jobs: [{ name: 'burn-in', conclusion: 'success', steps: [{ name: 'Continuous packed RC workloads', conclusion: 'success' }] }] };
  let zip, manifest, count = 0;
  async function pack() {
    put('orchestration-v2.json', f.context);
    put('expected.json', expected); put('burn-in.json', report);
    rmSync(join(raw, 'EVIDENCE-SHA256.json'), { force: true }); manifest = await recordEvidence(raw);
    const path = join(evidence, 'artifact.zip');
    execFileSync('python3', ['-c', 'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file(): z.write(f, f.relative_to(p).as_posix())', raw, path]); zip = readFileSync(path);
  }
  await pack();
  const metadata = { id: 123, tag_name: 'v3.0.0', draft: false, prerelease: false, published_at: '2026-10-20T11:00:00Z' };
  let refBytes = readFileSync(join(f.root, 'docs/release/post-release-soak.json'));
  const fetchImpl = async (url, options) => {
    count++; assert.equal(options.method, undefined, 'reader must never write remotely');
    const bytes = Buffer.from(encode(record));
    const assets = [{ name: 'release-record.json', url: `${API}/releases/assets/1`, digest: `sha256:${sha(bytes)}`, size: bytes.length }, { name: 'post-release-soak-reference.json', url: `${API}/releases/assets/2`, digest: `sha256:${sha(refBytes)}`, size: refBytes.length }];
    if (url === `${API}/releases/tags/v3.0.0`) return Response.json({ assets, ...metadata });
    if (url === assets[0].url) return new Response(bytes);
    if (url === assets[1].url) return new Response(refBytes);
    if (url === `${API}/actions/runs/246/attempts/1`) return Response.json(runProof);
    if (url === `${API}/actions/runs/246/attempts/1/jobs?per_page=100`) return Response.json(jobs);
    if (url === `${API}/actions/runs/246/artifacts?per_page=100`) return Response.json({ total_count: 1, artifacts: [{ id: 4, name: 'rc-burn-in', expired: false, workflow_run: { id: 246, head_sha: f.pin.donorCommit }, digest: `sha256:${sha(zip)}`, size_in_bytes: zip.length, archive_download_url: `${API}/actions/artifacts/4/zip` }] });
    if (url === `${API}/actions/artifacts/4/zip`) return new Response(zip);
    throw Error(`unexpected synthetic API read ${url}`);
  };
  const authenticated = { ...f.authenticated, packages, archives: evidence };
  const authenticate = async args => { assert.equal(args.tag, f.reference.rcTag); assert.equal(args.commit, f.reference.rcCommit); assert.equal(args.checkoutRequired, false); return authenticated; };
  let serial = 0;
  const args = () => ({ root: f.root, donorRoot: f.donorRoot, payloadRoot: f.payloadRoot, donorReview: f.pin, donorBranch: 'synthetic-donor', tag: 'v3.0.0', commit: f.commit, runId: 246, runAttempt: 1, manifestSha256: manifest, directory: join(evidence, `result-${++serial}`), fetchImpl, authenticate });
  return { ...f, args, record, metadata, authenticated, expected, report, runProof, jobs, pack, raw, evidence,
    reads: () => count, replaceReference: bytes => { refBytes = bytes; } };
}

test('separate actual identities, strict payload cleanliness and independently pinned donor diff', async t => {
  const f = checkouts(t);
  assert.equal(f.context.payload.commit, RC_COMMIT); assert.equal(f.context.donor.commit, f.pin.donorCommit);
  validateDonorReview(f.pin, f.donorRoot);
  for (const [key, value] of [['GITHUB_SHA', RC_COMMIT], ['GITHUB_WORKFLOW_SHA', RC_COMMIT], ['GITHUB_REF', `refs/tags/${RC_TAG}`], ['GITHUB_WORKFLOW_REF', 'wrong'], ['PYTHONDONTWRITEBYTECODE', '0'], ['GITHUB_RUN_ID', '0'], ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'forbidden']]) {
    assert.throws(() => workerContext({ ...f, env: { ...f.env, [key]: value } }));
  }
  assert.throws(() => workerContext({ ...f, payloadRoot: f.donorRoot }));
  writeFileSync(join(f.payloadRoot, 'untracked-control'), 'dirty');
  assert.throws(() => workerContext({ payloadRoot: f.payloadRoot, donorRoot: f.donorRoot, env: f.env }), /payload source/);
  assert.throws(() => requirePayload(f.payloadRoot), /payload source/);
  rmSync(join(f.payloadRoot, 'untracked-control'));
  const module = join(f.payloadRoot, 'packages/core/e2e/hostile-widgets/run.mjs'), bytes = readFileSync(module);
  writeFileSync(module, Buffer.concat([bytes, Buffer.from('\n// changed workload\n')]));
  assert.throws(() => requirePayload(f.payloadRoot), /payload source/); writeFileSync(module, bytes);
  git(f.payloadRoot, 'checkout', '--quiet', '--detach', FINAL_COMMIT);
  assert.throws(() => requirePayload(f.payloadRoot), /payload checkout/);
  git(f.payloadRoot, 'checkout', '--quiet', '--detach', RC_COMMIT);
  for (const patch of [{ donorCommit: RC_COMMIT }, { diffSha256: 'a'.repeat(64) }, { reviewEvidence: { content: '', sha256: sha('') } }]) assert.throws(() => validateDonorReview({ ...f.pin, ...patch }, f.donorRoot));
  const py = 'import importlib.util,sys; s=importlib.util.spec_from_file_location("owned",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)';
  const plain = { ...process.env }; delete plain.PYTHONDONTWRITEBYTECODE; delete plain.PYTHONPYCACHEPREFIX;
  execFileSync('python3', ['-c', py, join(f.payloadRoot, 'scripts/release-owned-linux.py')], { env: plain });
  assert.match(sourceStatus(f.payloadRoot), /__pycache__/);
  rmSync(join(f.payloadRoot, 'scripts/__pycache__'), { recursive: true });
  execFileSync('python3', ['-c', py, join(f.payloadRoot, 'scripts/release-owned-linux.py')], { env: { ...plain, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(sourceStatus(f.payloadRoot), '');
  const dependency = join(f.payloadRoot, 'node_modules/@playwright/test');
  mkdirSync(dependency, { recursive: true });
  writeFileSync(join(dependency, 'index.mjs'), 'export const chromium = { marker: "payload-only" };');
  assert(!existsSync(join(f.donorRoot, 'node_modules')));
  assert.equal((await loadPayloadPlaywright(f.payloadRoot)).chromium.marker, 'payload-only');
  assert.equal(sourceStatus(f.payloadRoot), '');
});

test('v2 authenticates donor API/archive provenance then unchanged RC raw validators; v1 rejects donor', async t => {
  const f = await completionFixture(t, checkouts(t));
  for (const root of [f.root, f.donorRoot, f.payloadRoot]) await assert.rejects(verifyPostReleaseSoakV2({ ...f.args(), directory: join(root, 'forbidden-output') }), /outside/);
  const result = await verifyPostReleaseSoakV2(f.args());
  assert.equal(result.contract, 'post-release-soak-verification-v2');
  assert.equal(result.soak.activeNanoseconds, '3600000000000');
  assert.equal(result.orchestration.donor.commit, f.pin.donorCommit);
  assert.equal(result.rc.commit, RC_COMMIT); assert.equal(result.final.originalDisposition.activeNanoseconds, '0');
  const rcFixtureIds = f.expected.fixtureCheckIds;
  const postReleaseCheck = 'extra:fauth: /t/acme/login: a delayed logo reserves its final space before image decode';
  assert(!rcFixtureIds.includes(postReleaseCheck));
  for (const ids of [[...rcFixtureIds, postReleaseCheck], rcFixtureIds.slice(1)]) {
    f.expected.fixtureCheckIds = ids; await f.pack();
    await assert.rejects(verifyPostReleaseSoakV2(f.args()), /fixture expectation differs from authenticated source/);
  }
  f.expected.fixtureCheckIds = rcFixtureIds; await f.pack();
  await assert.rejects(verifyPostReleaseSoak(f.args()));
  for (const [key, value] of [['head_sha', RC_COMMIT], ['head_branch', 'wrong'], ['path', '.github/workflows/rc-burn-in.yml'], ['conclusion', 'failure']]) {
    const previous = f.runProof[key]; f.runProof[key] = value;
    await assert.rejects(verifyPostReleaseSoakV2(f.args())); f.runProof[key] = previous;
  }
  assert.throws(() => verifyRun(f.runProof, { commit: RC_COMMIT, tag: RC_TAG, workflow: '.github/workflows/rc-burn-in.yml', event: 'workflow_dispatch' }));
  f.context.donor.commit = RC_COMMIT; await f.pack(); await assert.rejects(verifyPostReleaseSoakV2(f.args())); f.context.donor.commit = f.pin.donorCommit;
  for (const [object, key, value] of [[f.report, 'activeNanoseconds', '3599000000000'], [f.report, 'zeroFaults', false], [f.report.cleanup, 'remainingOwnedPids', [123]]]) {
    const original = object[key]; object[key] = value; await f.pack();
    await assert.rejects(verifyPostReleaseSoakV2(f.args())); object[key] = original;
  }
  // A hostile proof whose harness differs from the pinned RC's by one flipped hash is rejected, then restored.
  const hostileRaw = join(f.raw, 'round-001/hostile.json'), hostileBytes = readFileSync(hostileRaw), changed = json(hostileRaw);
  const [harnessFile, harnessHash] = Object.entries(changed.harnessSources)[0];
  changed.harnessSources[harnessFile] = (harnessHash[0] === '0' ? '1' : '0') + harnessHash.slice(1);
  writeFileSync(hostileRaw, encode(changed)); f.report.rounds[0].tasks[4].reportSha256 = sha(encode(changed));
  writeFileSync(join(f.raw, 'round-001/round.json'), encode(f.report.rounds[0]));
  await f.pack(); await assert.rejects(verifyPostReleaseSoakV2(f.args()), /hostile harness differs from current source/);
  writeFileSync(hostileRaw, hostileBytes); f.report.rounds[0].tasks[4].reportSha256 = sha(hostileBytes);
  writeFileSync(join(f.raw, 'round-001/round.json'), encode(f.report.rounds[0]));
  const raw = join(f.raw, 'round-001/hostile.json'), proof = json(raw); proof.sourceClean = false;
  writeFileSync(raw, encode(proof)); f.report.rounds[0].tasks[4].reportSha256 = sha(encode(proof));
  writeFileSync(join(f.raw, 'round-001/round.json'), encode(f.report.rounds[0]));
  await f.pack(); await assert.rejects(verifyPostReleaseSoakV2(f.args()));
});

test('donor workflow suppresses bytecode before Python, pins RC checkout and retains status without rewriting Actions identity', () => {
  const bytes = readFileSync(join(ROOT, WORKFLOW), 'utf8');
  const workflow = JSON.parse(execFileSync('ruby', ['-rjson', '-ryaml', '-e', 'v=YAML.load(STDIN.read); v["on"]=v.delete(true) if v.key?(true); puts JSON.generate(v)'], { input: bytes, encoding: 'utf8' }));
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const job = workflow.jobs['burn-in']; assert.equal(job.env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(job.env.CARGO_BUILD_JOBS, '3'); assert.equal(job['timeout-minutes'], 180);
  const checkouts = job.steps.filter(s => s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 2); assert.equal(checkouts[1].with.ref, RC_COMMIT);
  assert(checkouts.every(s => s.with['persist-credentials'] === false && s.with['fetch-depth'] === 0));
  assert(!/GITHUB_(?:REF|SHA|WORKFLOW_SHA)\s*[:=]/.test(bytes));
  assert(job.steps.some(s => s.if === 'always()' && s.run?.includes('release-soak-context-v2.mjs status')));
  assert(job.steps.filter(s => s.uses?.startsWith('actions/upload-artifact@')).every(s => s.if === 'always()'));
  assert(job.steps.find(s => s.name === 'Continuous packed RC workloads').run.includes('python3 scripts/release-owned-linux.py'));
});
