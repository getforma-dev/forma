import test from 'node:test';
import './module-trust-policy.test.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectRun, checkJobs } from './check-release-ci.mjs';
import { registryStatus, waitForPackage, npmPublishArgs, cargoPublishArgs } from './release-publish.mjs';
import { ROOT, SEMVER, assertReleaseSet, stageCargoLock, stageNpmLock, stageTemplates, versionFiles, compatibilityPeer, templateRequirement, digest, run, json, packCargoWorkspace, milestoneOf, releaseMilestone, assertMilestoneReady, MILESTONES } from './release-set.mjs';

// Historical policies must remain testable when the live contract moves to a new release.
const historicalContractPath = join(ROOT, 'scripts/fixtures/release-contracts-3.0.0.json');
const historicalContracts = () => json(historicalContractPath);
const seededContract = mutate => { const c = historicalContracts(); mutate(c); return c; };
const milestoneNames = ['alpha', 'beta', 'rc', 'final'];
const seededMilestones = (statuses, source = historicalContracts()) => {
  const c = structuredClone(source);
  for (const milestone of milestoneNames) {
    assert(['done', 'pending'].includes(statuses[milestone]), `${milestone}: explicit seeded status required`);
    for (const gate of Object.values(c.milestones[milestone].gates)) {
      gate.status = statuses[milestone];
      delete gate.deferral; // Synthetic done/pending states cannot retain a live deferral.
    }
  }
  return c;
};
test('historical 3.0 release contract retains its original authenticated bytes', () => {
  assert.equal(digest(historicalContractPath), 'bd4802df6d071b9847a136836b426dec1c4b4d88595215f4d8ecc6783c358510');
  assert.equal(historicalContracts().version, '3.0.0');
});
test('the live contract has valid gates bound to the current package line without assuming readiness', () => {
  const current = json(join(ROOT, 'scripts/release-contracts.json'));
  const original = structuredClone(current);
  const packageVersion = json(join(ROOT, 'packages/core/package.json')).version;
  assert.equal(current.version, packageVersion.split('-')[0]);
  const final = releaseMilestone(current, current.version);
  assert.equal(final.name, 'final');
  assert.equal(final.version, current.version);
  assert.equal(final.ready, final.blocking.length === 0);
  const [major, minor] = current.version.split('.').map(Number);
  assert.throws(() => releaseMilestone(current, `${major}.${minor + 1}.0-rc.1`), /the contract gates/);
  const pending = seededMilestones({ alpha: 'pending', beta: 'pending', rc: 'pending', final: 'pending' }, current);
  for (const name of milestoneNames) {
    const version = name === 'final' ? current.version : `${current.version}-${name}.1`;
    assert.equal(releaseMilestone(pending, version).ready, false);
    assert.throws(() => assertMilestoneReady(pending, version), /nothing may publish/);
  }
  assert.deepEqual(current, original, 'validation and synthetic pending states must not alter the live contract');
});
test('a synthetic pending 3.1 contract grants no inherited release credit or historical soak waiver', () => {
  // Deliberately fictitious gates: these test inputs are not a release plan or evidence.
  const pending = { version: '3.1.0', milestones: Object.fromEntries(milestoneNames.map((name, i) => [name, {
    plan: `M${i + 2}`, gates: { [`FORMA-${900 + i}`]: { status: 'pending', scope: `synthetic ${name} control, no release credit` } },
  }])) };
  for (const [i, name] of milestoneNames.entries()) {
    const version = name === 'final' ? '3.1.0' : `3.1.0-${name}.1`;
    const result = releaseMilestone(pending, version);
    assert.equal(result.ready, false);
    assert.equal(result.blocking.length, i + 1);
    assert.deepEqual(Object.keys(result.later), milestoneNames.slice(i + 1));
    assert.throws(() => assertMilestoneReady(pending, version), /nothing may publish/);
  }
  for (const version of ['3.0.0', '3.0.0-rc.1', '3.1.1', '4.0.0-rc.1']) {
    assert.throws(() => releaseMilestone(pending, version), /gates 3\.1\.0, not/);
  }
  const inheritedWaiver = structuredClone(pending);
  inheritedWaiver.milestones.final.gates['FORMA-145 soak'] = historicalContracts().milestones.final.gates['FORMA-145 soak'];
  assert.throws(() => releaseMilestone(inheritedWaiver, '3.1.0'), /only authorized for final 3\.0\.0/);
});
test('synthetic milestone states do not inherit a live final soak deferral', () => {
  const source = historicalContracts(), soak = source.milestones.final.gates['FORMA-145 soak'];
  soak.status = 'deferred';
  soak.deferral = { decision: 'L-66-QUOTA', finalVersion: '3.0.0', reference: 'docs/release/post-release-soak.json' };
  for (const status of ['done', 'pending']) {
    const seeded = seededMilestones({ alpha: 'done', beta: 'done', rc: 'done', final: status }, source);
    assert.equal('deferral' in seeded.milestones.final.gates['FORMA-145 soak'], false);
    assert.equal(releaseMilestone(seeded, '3.0.0').ready, status === 'done');
  }
  assert.equal(soak.status, 'deferred');
  assert.equal(releaseMilestone(source, '3.0.0').deferred.length, 1);
  soak.status = 'done';
  assert.throws(() => releaseMilestone(source, '3.0.0'), /completed\/pending gate cannot carry a deferral/);
});
test('L-60 defers live governance only; source probes and other release gates still block', () => {
  const c = historicalContracts();
  const live = c.informational['FORMA-116 live rollout'];
  assert.equal(live?.status, 'deferred');
  assert.equal(live.decision, 'L-60 (2026-10-16)');
  assert.equal(live.owner, 'Victor');
  for (const milestone of Object.values(c.milestones)) assert(!('FORMA-116 live rollout' in milestone.gates));
  assert.match(c.milestones.rc.gates['FORMA-116'].scope, /SR14/);
  const complete = seededMilestones({ alpha: 'done', beta: 'done', rc: 'done', final: 'done' });
  assert.equal(assertMilestoneReady(complete, '3.0.0').ready, true);
  assert.equal(complete.informational['FORMA-116 live rollout'].status, 'deferred');
  for (const [milestone, ticket] of [
    ['rc', 'FORMA-116'], ['rc', 'FORMA-145 audit'],
    ['final', 'FORMA-191'], ['final', 'FORMA-145 soak'],
  ]) {
    const pending = structuredClone(complete);
    pending.milestones[milestone].gates[ticket].status = 'pending';
    const result = releaseMilestone(pending, '3.0.0');
    assert.equal(result.ready, false);
    assert.deepEqual(result.blocking, [`${ticket} (${milestone}): ${pending.milestones[milestone].gates[ticket].scope}`]);
    assert.throws(() => assertMilestoneReady(pending, '3.0.0'), /nothing may publish/);
  }
  const invalid = structuredClone(c);
  invalid.milestones.rc.gates['FORMA-116'].status = 'deferred';
  assert.throws(() => releaseMilestone(invalid, '3.0.0'), /done\/pending status/);
});
test('L-57 external application runs are informational while documentation and the required RC burn-in still block', () => {
  const c = historicalContracts();
  for (const ticket of ['FORMA-192', 'FORMA-147']) {
    assert.equal(c.informational[ticket].status, 'not-run');
    for (const milestone of Object.values(c.milestones)) assert(!(ticket in milestone.gates));
  }
  const required = seededMilestones({ alpha: 'done', beta: 'done', rc: 'done', final: 'done' });
  required.milestones.rc.gates['FORMA-145 documentation'].status = 'pending';
  required.milestones.final.gates['FORMA-145 soak'].status = 'pending';
  const final = releaseMilestone(required, '3.0.0');
  assert.deepEqual(final.blocking.map(gate => gate.slice(0, gate.indexOf(':'))), [
    'FORMA-145 documentation (rc)',
    'FORMA-145 soak (final)',
  ]);
});
test('milestone gate: explicit earned states publish while later seeded gates still wait', () => {
  const alphaState = seededMilestones({ alpha: 'done', beta: 'pending', rc: 'pending', final: 'pending' });
  const alpha = assertMilestoneReady(alphaState, '3.0.0-alpha.1');
  assert.equal(alpha.name, 'alpha'); assert.equal(alpha.plan, 'M2'); assert.equal(alpha.ready, true); assert.deepEqual(alpha.blocking, []);
  assert.deepEqual(Object.keys(alpha.later), ['beta', 'rc', 'final']);
  assert(alpha.later.beta.some(gate => gate.startsWith('FORMA-188 fixture applications:')));
  assert(alpha.later.final.some(gate => gate.startsWith('FORMA-191:')));
  for (const version of ['3.0.0-beta.1', '3.0.0-rc.1', '3.0.0']) assert.throws(() => assertMilestoneReady(alphaState, version), /still waits for: .*nothing may publish/);
  const betaState = seededMilestones({ alpha: 'done', beta: 'done', rc: 'pending', final: 'pending' });
  const beta = assertMilestoneReady(betaState, '3.0.0-beta.1');
  assert.equal(beta.name, 'beta'); assert.equal(beta.ready, true); assert.deepEqual(beta.blocking, []); assert.deepEqual(Object.keys(beta.later), ['rc', 'final']);
  const rcState = seededMilestones({ alpha: 'done', beta: 'done', rc: 'done', final: 'pending' });
  const rc = assertMilestoneReady(rcState, '3.0.0-rc.1');
  assert.equal(rc.name, 'rc'); assert.equal(rc.ready, true); assert.deepEqual(rc.blocking, []); assert.deepEqual(Object.keys(rc.later), ['final']);
  const finalState = seededMilestones({ alpha: 'done', beta: 'done', rc: 'done', final: 'done' });
  const final = assertMilestoneReady(finalState, '3.0.0');
  assert.equal(final.name, 'final'); assert.equal(final.ready, true); assert.deepEqual(final.blocking, []); assert.deepEqual(final.later, {});
  assert.throws(() => releaseMilestone(historicalContracts(), '3.0.0-dev'), /development version/);
  assert.equal(milestoneOf('3.0.0-dev'), null); assert.equal(milestoneOf('3.0.0-alpha.1'), 'alpha'); assert.equal(milestoneOf('3.0.0-rc.2'), 'rc'); assert.equal(milestoneOf('3.1.0'), 'final');
  assert.deepEqual(MILESTONES, ['alpha', 'beta', 'rc', 'final']);
  // The historical contract is written for 3.0.0: a later version's pre-release cannot ride on its gates.
  assert.equal(historicalContracts().version, '3.0.0');
  for (const version of ['3.1.0-alpha.1', '3.0.1-alpha.1', '4.0.0']) assert.throws(() => releaseMilestone(historicalContracts(), version), /gates 3\.0\.0, not/);
  assert.throws(() => releaseMilestone(seededContract(c => { delete c.version; }), '3.0.0-alpha.1'), /names no release version/);
  assert.throws(() => releaseMilestone(seededContract(c => { c.version = '3.0.0-alpha.1'; }), '3.0.0-alpha.1'), /names no release version/);
  // Pre-release counters start at 1: -alpha.0 is not a version, so it names no milestone.
  for (const version of ['3.0.0-alpha.0', '3.0.0-beta.0', '3.0.0-rc.0', '3.0.0-alpha.01']) {
    assert.equal(SEMVER.test(version), false, version);
    assert.throws(() => milestoneOf(version), /not a release version/);
  }
  const seven = Array.from({ length: 7 }, (_, i) => ({ name: `package-${i}`, version: '3.0.0-alpha.0' }));
  assert.throws(() => assertReleaseSet(seven, 'v3.0.0-alpha.0'), /release requires/);
});
test('milestone gate: an open gate in the milestone or any earlier one refuses; a malformed contract refuses every milestone', () => {
  const complete = seededMilestones({ alpha: 'done', beta: 'done', rc: 'done', final: 'done' });
  const versions = { alpha: '3.0.0-alpha.1', beta: '3.0.0-beta.1', rc: '3.0.0-rc.1', final: '3.0.0' };
  for (const milestone of milestoneNames) for (const ticket of Object.keys(complete.milestones[milestone].gates)) {
    const oneOpen = structuredClone(complete);
    oneOpen.milestones[milestone].gates[ticket].status = 'pending';
    const result = releaseMilestone(oneOpen, versions[milestone]);
    assert.equal(result.ready, false, `${milestone}: ${ticket}`);
    assert.equal(result.blocking.length, 1, `${milestone}: ${ticket}`);
    assert(result.blocking[0].startsWith(`${ticket} (${milestone}):`), `${milestone}: ${ticket}`);
    assert.throws(() => assertMilestoneReady(oneOpen, versions[milestone]), /nothing may publish/);
  }
  for (const [milestone, ticket, version] of [
    ['alpha', 'FORMA-110', '3.0.0-beta.1'],
    ['beta', 'FORMA-103', '3.0.0-rc.1'],
    ['rc', 'FORMA-101', '3.0.0'],
  ]) {
    const inherited = structuredClone(complete);
    inherited.milestones[milestone].gates[ticket].status = 'pending';
    assert.throws(() => assertMilestoneReady(inherited, version), new RegExp(`${ticket} \\(${milestone}\\)`));
  }
  for (const [pattern, mutate] of [
    [/global publish switch/, c => { c.liveReleaseReady = true; }],
    [/global publish switch/, c => { c.pending = {}; }],
    [/names no milestones/, c => { delete c.milestones; }],
    [/no gates for rc/, c => { delete c.milestones.rc; }],
    [/no gates for final/, c => { c.milestones.final.gates = {}; }],
    [/no plan milestone/, c => { delete c.milestones.beta.plan; }],
    [/not a ticket gate/, c => { c.milestones.alpha.gates['founder says so'] = { status: 'done', scope: 'x' }; }],
    [/gates more than one milestone/, c => { c.milestones.beta.gates['FORMA-110'] = { status: 'done', scope: 'again' }; }],
    [/status and a scope/, c => { c.milestones.alpha.gates['FORMA-110'].status = 'skipped'; }],
    [/status and a scope/, c => { c.milestones.rc.gates['FORMA-101'].scope = ' '; }],
  ]) assert.throws(() => releaseMilestone(seededContract(mutate), '3.0.0-alpha.1'), pattern);
});
test('npm pre-releases publish on next and finals on latest; Cargo publishes the pre-release version itself', () => {
  assert.deepEqual(npmPublishArgs({ name: '@getforma/core', version: '3.0.0-alpha.1' }, '/x/core.tgz'), ['publish', '/x/core.tgz', '--ignore-scripts', '--provenance', '--access', 'public', '--tag', 'next']);
  for (const version of ['3.0.0-beta.2', '3.0.0-rc.1']) assert.equal(npmPublishArgs({ name: 'x', version }, 'f').at(-1), 'next');
  assert.equal(npmPublishArgs({ name: 'x', version: '3.0.0' }, 'f').at(-1), 'latest');
  assert.throws(() => npmPublishArgs({ name: 'x', version: '3.0.0-dev' }, 'f'));
  assert.throws(() => npmPublishArgs({ name: 'x', version: '3.0.0-next' }, 'f'));
  assert.deepEqual(cargoPublishArgs([{ name: 'forma-ir', version: '3.0.0-alpha.1' }, { name: 'forma-server', version: '3.0.0-alpha.1' }]), ['publish', '-p', 'forma-ir', '-p', 'forma-server', '--no-verify', '--locked']);
  assert.throws(() => cargoPublishArgs([{ name: 'forma-ir', version: '3.0.0-dev' }]));
});

const sha = 'a'.repeat(40), repo = 'getforma-dev/forma';
const goodRun = { id: 100, head_sha: sha, head_branch: 'main', event: 'push', path: '.github/workflows/ci.yml', repository: { full_name: repo }, status: 'completed', conclusion: 'success', run_number: 7, run_attempt: 1 };
test('SR13 accepts only the latest exact-SHA main CI run', () => {
  assert.equal(selectRun({ workflow_runs: [goodRun] }, sha, repo).id, 100);
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { head_branch: 'other' }, { status: 'in_progress' }, { conclusion: 'failure' }, { repository: { full_name: 'elsewhere/forma' } }, { path: 'other.yml' }]) {
    assert.throws(() => selectRun({ workflow_runs: [{ ...goodRun, ...patch }] }, sha, repo));
  }
  assert.throws(() => selectRun({ workflow_runs: [goodRun, { ...goodRun, run_number: 8, conclusion: 'failure' }] }, sha, repo));
});
test('SR13 missing or unreadable status refuses publication', () => {
  for (const response of [null, {}, { workflow_runs: [] }, { workflow_runs: 'unreadable' }]) assert.throws(() => selectRun(response, sha, repo));
});
test('SR13 a skipped or missing R17/probe job cannot be a successful gate', () => {
  const jobs = [{ name: 'check', status: 'completed', conclusion: 'success', steps: [{ name: "R17's command", conclusion: 'success' }] }, ...['release-workflow','candidate-pack','candidate-scaffold (ubuntu-latest)','candidate-scaffold (windows-latest)'].map(name=>({name,status:'completed',conclusion:'success',steps:[{name:name==='candidate-pack'?'Pack committed candidates and record ten-file restoration':'Packed candidate full scaffold suite',conclusion:'success'}]}))];
  checkJobs({ jobs });
  for (const bad of [[], [{ ...jobs[0], conclusion: 'skipped' }, jobs[1]], [{ ...jobs[0], steps: [] }, jobs[1]], [jobs[0]]]) assert.throws(() => checkJobs({ jobs: bad }));
  for (const name of ['candidate-pack','candidate-scaffold (ubuntu-latest)','candidate-scaffold (windows-latest)']) {
    assert.throws(()=>checkJobs({jobs:jobs.filter(job=>job.name!==name)}),/did not run/);
    for(const conclusion of ['skipped','failure','cancelled'])assert.throws(()=>checkJobs({jobs:jobs.map(job=>job.name===name?{...job,conclusion}:job)}),/did not run/);
    assert.throws(()=>checkJobs({jobs:jobs.map(job=>job.name===name?{...job,steps:[]}:job)}),/step did not execute/);
  }
});
test('a live tag cannot publish mixed A2 versions, dev versions or a partial set', () => {
  const packages = Array.from({ length: 7 }, (_, i) => ({ name: `package-${i}`, version: '3.0.0-alpha.1' }));
  assert.equal(assertReleaseSet(packages, 'v3.0.0-alpha.1'), '3.0.0-alpha.1');
  assert.throws(() => assertReleaseSet([...packages, {}], 'v3.0.0-alpha.1'));
  assert.throws(() => assertReleaseSet(packages.map((p, i) => i ? p : { ...p, version: '2.1.0' }), 'v3.0.0-alpha.1'));
  for (const tag of ['main', 'v3.0.0-dev', 'v2.0.0', 'v3.0.0;echo pwned', 'v03.0.0']) assert.throws(() => assertReleaseSet(packages, tag));
});
test('version preparation changes eight manifests, exact internal requirements and repositories without publishing', () => {
  const before = json(join(ROOT, 'packages/core/package.json')).version;
  const files = versionFiles(ROOT, '3.0.0-alpha.1');
  for (const name of ['core', 'compiler', 'build', 'router', 'create-app']) {
    const p = JSON.parse(files.get(`packages/${name}/package.json`));
    assert.equal(p.version, '3.0.0-alpha.1');
    assert.equal(p.repository.url, 'git+https://github.com/getforma-dev/forma.git');
  }
  assert.match(files.get('Cargo.toml'), /version = "3.0.0-alpha.1"/);
  // forma-ir and forma-server inherit the workspace version; forma-ir-derive declares its own.
  for (const crate of ['forma-ir', 'forma-ir-derive', 'forma-server']) assert.match(files.get(`crates/${crate}/Cargo.toml`), /^version(?: = "3\.0\.0-alpha\.1"|\.workspace = true)$/m, `${crate}: Cargo pre-release version`);
  assert.match(files.get('crates/forma-ir-derive/Cargo.toml'), /version = "3.0.0-alpha.1"/);
  assert.match(files.get('crates/forma-server/Cargo.toml'), /version = "=3.0.0-alpha.1"/);
  assert.match(files.get('packages/create-app/templates/minimal/Cargo.toml'), /forma-ir = "=3.0.0-alpha.1"/);
  assert.equal(json(join(ROOT, 'packages/core/package.json')).version, before, 'pure preparation must not alter source');
  const dev = versionFiles(ROOT, '3.0.1-dev');
  assert(dev.get('Cargo.toml').includes('3.0.1-dev'));
  assert.match(dev.get('packages/create-app/templates/minimal/Cargo.toml'), /forma-ir = "=3.0.1-dev"/);
  assert.equal(JSON.parse(dev.get('packages/create-app/template-lock-seeds.json')).version, '3.0.1-dev');
});
test('version preparation keeps every Cargo workspace aligned without changing external pins', () => {
  const paths = ['Cargo.lock', 'e2e/Cargo.lock', 'fuzz/Cargo.lock'];
  const originals = new Map(paths.map(path => [path, readFileSync(join(ROOT, path), 'utf8')]));
  const blocks = text => text.split(/(?=\[\[package\]\])/);
  const isInternal = block => /^name = "forma-(?:ir|ir-derive|server)"$/m.test(block);
  for (const version of ['3.0.1-dev', '3.0.0-alpha.1', '3.0.0']) {
    const files = versionFiles(ROOT, version);
    for (const [path, original] of originals) {
      const prepared = files.get(path);
      assert.equal(typeof prepared, 'string', `${path}: version preparation must include this workspace`);
      const local = blocks(prepared).filter(isInternal);
      assert(local.length, `${path}: fixture must contain an internal package`);
      for (const block of local) assert.equal(/^version = "([^"]+)"$/m.exec(block)?.[1], version, path);
      assert.deepEqual(blocks(prepared).filter(block => !isInternal(block)), blocks(original).filter(block => !isInternal(block)), `${path}: external versions, dependencies and checksums must remain byte-identical`);
      assert.equal(readFileSync(join(ROOT, path), 'utf8'), original, 'versionFiles must stay pure');
    }
  }
});
test('version preparation remains valid under the actual internal dependency guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-version-guard-'));
  try {
    for (const version of ['3.0.0-dev', '3.0.0-alpha.1', '3.0.0']) {
      for (const [path, text] of versionFiles(ROOT, version)) {
        const full = join(dir, path);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, text);
      }
      for (const crate of ['forma-ir', 'forma-ir-derive', 'forma-server']) {
        const source = join(dir, 'crates', crate, 'src');
        mkdirSync(source, { recursive: true });
        writeFileSync(join(source, 'lib.rs'), '');
      }
      assert.match(run('bash', [join(ROOT, 'scripts/check-forma-ir-requirement.sh'), join(dir, 'Cargo.toml')]), /ok: forma-server/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Cargo repacks identical source deterministically and changed source with fresh predecessor checksums', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-cargo-package-'));
  try {
    writeFileSync(join(dir, '.gitignore'), '/target/\n/out-*/\n');
    writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["first", "second"]\nresolver = "2"\n');
    for (const name of ['first', 'second']) {
      mkdirSync(join(dir, name, 'src'), { recursive: true });
      const dependency = name === 'second' ? '\n[dependencies]\nforma-release-test-first = { path = "../first", version = "=3.0.0-alpha.1" }\n' : '';
      writeFileSync(join(dir, name, 'Cargo.toml'), `[package]\nname = "forma-release-test-${name}"\nversion = "3.0.0-alpha.1"\nedition = "2021"\nlicense = "MIT"\ndescription = "Unpublished release packaging test"\n${dependency}`);
      writeFileSync(join(dir, name, 'src/lib.rs'), 'pub fn value() -> u8 { 1 }\n');
    }
    run('cargo', ['generate-lockfile', '--offline'], dir);
    run('git', ['init', '-q'], dir); run('git', ['add', '.'], dir);
    run('git', ['-c', 'user.name=Forma release test', '-c', 'user.email=release-test@example.invalid', 'commit', '-qm', 'fixture'], dir);
    const lock = digest(join(dir, 'Cargo.lock'));
    const packages = ['first', 'second'].map(n => ({ registry: 'crates', name: `forma-release-test-${n}`, version: '3.0.0-alpha.1' }));
    const packed = suffix => {
      const out = join(dir, `out-${suffix}`); mkdirSync(out);
      packCargoWorkspace(dir, packages, out, { offline: true });
      const hashes = packages.map(p => digest(join(out, `${p.name}-${p.version}.crate`)));
      const second = packages[1];
      const archive = join(out, `${second.name}-${second.version}.crate`);
      const packedLock = run('tar', ['-xOf', archive, `${second.name}-${second.version}/Cargo.lock`]);
      const predecessor = packedLock.split(/(?=\[\[package\]\])/).find(block => /^name = "forma-release-test-first"$/m.test(block));
      assert.equal(/^checksum = "([^"]+)"/m.exec(predecessor ?? '')?.[1], hashes[0], 'dependent crate must pin the actual newly packed predecessor');
      const vcs = JSON.parse(run('tar', ['-xOf', archive, `${second.name}-${second.version}/.cargo_vcs_info.json`]));
      assert.equal(vcs.git.sha1, run('git', ['rev-parse', 'HEAD'], dir).trim(), 'packed provenance must identify the source commit');
      assert.equal(vcs.path_in_vcs, 'second');
      assert.equal(digest(join(dir, 'Cargo.lock')), lock, 'source lock must remain unchanged');
      return hashes;
    };
    const first = packed('one');
    assert.deepEqual(packed('same'), first);
    writeFileSync(join(dir, 'first/src/lib.rs'), 'pub fn value() -> u8 { 2 }\n');
    run('git', ['add', 'first/src/lib.rs'], dir);
    run('git', ['-c', 'user.name=Codex', '-c', 'user.email=codex@openai.com', 'commit', '-qm', 'change predecessor source'], dir);
    const changed = packed('changed');
    assert.notEqual(changed[0], first[0], 'the source change must produce a different predecessor archive');
    assert.notEqual(changed[1], first[1], 'the dependent must carry the new predecessor checksum and source provenance');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('template Cargo.lock staging preserves third-party resolutions and never invents checksums', () => {
  const source = '[version]\nvalue = 3\n\n[[package]]\nname = "forma-ir"\nversion = "0.2.2"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "old"\n\n[[package]]\nname = "serde"\nversion = "1.2.3"\nchecksum = "untouched"\n';
  const packages = [{ registry: 'crates', name: 'forma-ir', version: '3.0.0', sha256: 'c'.repeat(64) }];
  const shipped = stageCargoLock(source, packages);
  assert(shipped.includes('checksum = "' + 'c'.repeat(64) + '"'));
  assert(shipped.endsWith('name = "serde"\nversion = "1.2.3"\nchecksum = "untouched"\n'));
  const local = stageCargoLock(shipped, packages, true);
  assert(!local.includes('source ='));
  assert(!local.includes('c'.repeat(64)));
  assert.throws(() => stageCargoLock(source.replace('checksum = "old"\n', ''), packages));
});
test('stable template ranges advance with the set while development and prereleases stay exact', () => {
  for (const version of ['3.0.0', '3.2.1', '4.0.0']) assert.equal(templateRequirement(version), `^${version}`);
  for (const version of ['3.0.0-dev', '3.0.0-alpha.1', '3.0.0-beta.1', '3.0.0-rc.1']) assert.equal(templateRequirement(version), `=${version}`);
  for (const version of ['2.1.0', '^3.0.0', '3.0.0-rc.0', '3.0.0-next']) assert.throws(() => templateRequirement(version));
});
for (const version of ['3.0.0-beta.1', '3.0.0']) test(`staged ${version} npm locks authenticate actual packed bytes despite manifest ranges`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-release-test-'));
  try {
    mkdirSync(join(dir, 'package'));
    writeFileSync(join(dir, 'package/package.json'), JSON.stringify({ name: '@getforma/core', version, dependencies: { 'alien-signals': '3.1.2' } }));
    run('tar', ['-czf', join(dir, 'core.tgz'), '-C', dir, 'package']);
    const manifest = { dependencies: { '@getforma/core': '^2.1.0', external: '1.0.0' } };
    const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/@getforma/core': { version: '2.1.0' }, 'node_modules/external': { version: '1.0.0', integrity: 'exact-lock' } } };
    const packages = [{ registry: 'npm', name: '@getforma/core', version, file: 'core.tgz' }];
    const shipped = stageNpmLock(manifest, lock, packages, dir);
    assert.equal(shipped.manifest.dependencies['@getforma/core'], version.includes('-') ? `=${version}` : `^${version}`);
    assert.equal(shipped.lock.packages['node_modules/@getforma/core'].version, version);
    assert.equal(shipped.lock.packages['node_modules/@getforma/core'].integrity, `sha512-${digest(join(dir, 'core.tgz'), 'sha512', 'base64')}`);
    assert.deepEqual(shipped.lock.packages['node_modules/external'], lock.packages['node_modules/external']);
    const local = stageNpmLock(shipped.manifest, shipped.lock, packages, dir, true);
    assert.equal(local.lock.packages['node_modules/@getforma/core'].resolved, `file:${join(dir, 'core.tgz')}`);
    assert.equal(local.manifest.dependencies['@getforma/core'], `file:${join(dir, 'core.tgz')}`);
    assert.equal(lock.packages['node_modules/@getforma/core'].version, '2.1.0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('partial-release rerun accepts only byte-identical existing packages; network failures never mean missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-registry-test-'));
  try {
    writeFileSync(join(dir, 'package.tgz'), 'candidate');
    const p = { registry: 'npm', name: '@getforma/core', version: '3.0.0', file: 'package.tgz' };
    const mock = (status, data) => async () => ({ status, ok: status === 200, json: async () => data });
    assert.equal(await registryStatus(p, dir, mock(404)), 'missing');
    assert.equal(await registryStatus(p, dir, mock(200, { dist: { integrity: `sha512-${digest(join(dir, 'package.tgz'), 'sha512', 'base64')}` } })), 'present');
    await assert.rejects(registryStatus(p, dir, mock(503)));
    await assert.rejects(registryStatus(p, dir, mock(200, { dist: { integrity: 'different' } })));
    const crate = { registry: 'crates', name: 'forma-ir', version: '3.0.0', sha256: 'd'.repeat(64) };
    assert.equal(await registryStatus(crate, dir, mock(200, { version: { checksum: crate.sha256, yanked: false } })), 'present');
    await assert.rejects(registryStatus(crate, dir, mock(200, { version: { checksum: crate.sha256, yanked: true } })));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('registry polling never starts a request after its fixed deadline', async () => {
  let clock = 0, calls = 0;
  const options = { now: () => clock, sleep: async ms => { clock += ms; }, request: async () => { calls++; clock += 400; return { status: 404 }; } };
  await assert.rejects(waitForPackage({ name: 'test', registry: 'crates', version: '1.0.0' }, '/', 1000, options), /deadline/);
  assert.equal(calls, 1);
  assert.equal(clock, 1000);
  calls = 0;
  await assert.rejects(waitForPackage({ name: 'test' }, '/', 0, options), /deadline/);
  assert.equal(calls, 0);
});

test('malformed second template leaves every source file unchanged during staging', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-stage-test-'));
  const before = new Map();
  try {
    for (const name of ['minimal', 'dashboard']) {
      const base = join(dir, 'packages/create-app/templates', name);
      mkdirSync(join(base, 'admin'), { recursive: true });
      for (const [file, content] of [
        ['admin/package.json', '{}\n'], ['admin/package-lock.json', '{"packages":{"":{}}}\n'], ['Cargo.toml', '[dependencies]\nforma-ir = "0.2.2"\n'],
        ['Cargo.lock', '[[package]]\nname = "forma-ir"\nversion = "0.2.2"\n' + (name === 'minimal' ? 'checksum = "original"\n' : '')],
      ]) { const path = join(base, file); writeFileSync(path, content); before.set(path, content); }
    }
    assert.throws(() => stageTemplates(dir, [{ registry: 'crates', name: 'forma-ir', version: '3.0.0', sha256: 'a'.repeat(64) }], dir), /missing checksum/);
    for (const [path, content] of before) assert.equal(readFileSync(path, 'utf8'), content);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('version preparation keeps the window peers and exact packed crate pins distinct', () => {
  for (const [version, expected] of [
    ['3.2.7', '^3.2.0'], ['3.2.0-dev', '^3.2.0 || =3.2.0-dev'],
    ['3.2.0-alpha.1', '^3.2.0 || =3.2.0-alpha.1'],
  ]) {
    assert.equal(compatibilityPeer(version), expected);
    const files = versionFiles(ROOT, version);
    for (const [member, peer] of [['compiler', '@getforma/core'], ['router', '@getforma/core'], ['build', '@getforma/compiler']]) {
      const manifest = JSON.parse(files.get(`packages/${member}/package.json`));
      const locked = JSON.parse(files.get('package-lock.json')).packages[`packages/${member}`];
      assert.equal(manifest.peerDependencies[peer], expected);
      assert.equal(locked.peerDependencies[peer], expected);
      if (member === 'build') assert.equal(manifest.peerDependenciesMeta[peer].optional, true);
    }
    assert.match(files.get('crates/forma-server/Cargo.toml'), new RegExp(`version = "=${version.replaceAll('.', '\\.') }"`));
  }
});
