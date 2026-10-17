import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, CRATES, NPM, digest, assertReleaseSet, releaseMilestone } from './release-set.mjs';
import { performanceTarget } from './release-performance.mjs';
import { P17_BUDGET_SECONDS, p17Time } from './release-measurements.mjs';

const actual = JSON.parse(execFileSync('ruby', ['-rjson', '-ryaml', '-e',
  'v=YAML.load(STDIN.read); v["on"]=v.delete(true) if v.key?(true); puts JSON.generate(v)'],
{ input: readFileSync(join(ROOT, '.github/workflows/packed-qualification.yml')), encoding: 'utf8' }));
const authName = 'Authenticate the original DS11 source, versions and Cargo lock';
const runName = 'Whole packed P17 under Linux process ownership';
const step = (workflow, job, name) => workflow.jobs[job].steps.find(row => row.name === name);
const wholeCommand = 'mkdir "$RUNNER_TEMP/p17"\npython3 scripts/release-owned-linux.py "$RUNNER_TEMP/p17-owned" 2640 -- node scripts/verify-release-set.mjs "$RUNNER_TEMP/candidate artifacts" "$RUNNER_TEMP/p17/p17.json"';

function validate(workflow) {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs, { target_tag: {
    description: 'Intended release tag; all seven checked-out versions must match',
    required: true, default: 'v3.0.0-beta.3', type: 'string',
  } });
  assert.equal(workflow.permissions, undefined);
  assert.deepEqual(workflow.concurrency, { group: 'packed-qualification-${{ github.ref }}', 'cancel-in-progress': false });
  assert.deepEqual(workflow.env, {
    CARGO_BUILD_JOBS: '3', CARGO_INCREMENTAL: '0', CARGO_TERM_COLOR: 'never',
    CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS: 'fallback', PLAYWRIGHT_SKIP_BROWSER_GC: '1',
    FORMA_PERFORMANCE_TARGET_TAG: '${{ inputs.target_tag }}',
  });
  assert(!JSON.stringify(workflow).includes('secrets.'), 'qualification has no publishing secrets');
  assert.deepEqual(Object.keys(workflow.jobs), ['pack', 'verify']);
  assert.equal(workflow.jobs.pack['timeout-minutes'], 20);
  assert.equal(workflow.jobs.verify['timeout-minutes'], 60);
  assert.equal(workflow.jobs.verify.needs, 'pack');
  assert.deepEqual(workflow.jobs.pack.outputs, { 'record-sha256': '${{ steps.pack.outputs.record-sha256 }}' });
  for (const job of Object.values(workflow.jobs)) {
    assert.deepEqual(job.permissions, { contents: 'read' });
    assert.equal(job['runs-on'], 'ubuntu-latest');
    for (const key of ['if', 'continue-on-error', 'environment', 'secrets', 'uses', 'env']) assert.equal(job[key], undefined);
    for (const row of job.steps) {
      assert.equal(row['continue-on-error'], undefined);
      if (row.uses) assert.match(row.uses, /^[^@]+@[a-f0-9]{40}$/);
      if (row.if) assert(row.uses?.startsWith('actions/upload-artifact@') && row.if === 'always()');
      assert(!row.run?.includes('${{'), 'input/expression values must enter commands through environment variables');
      assert(!/release-publish|release-record|npm publish|cargo publish|gh release|git push|release-set\.mjs version/.test(row.run ?? ''));
    }
    const checkout = job.steps.filter(row => row.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.length, 1);
    assert.deepEqual(checkout[0].with, { ref: '${{ github.sha }}', 'persist-credentials': false });
    assert(job.steps.some(row => row.run === 'bash scripts/install-deps.sh'));
    const uploads = job.steps.filter(row => row.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(uploads.length, 1); assert.equal(uploads[0].if, 'always()');
    assert.equal(uploads[0].with['if-no-files-found'], 'error');
  }
  assert(workflow.jobs.pack.steps.some(row => row.run === 'node scripts/release-set.mjs check "$FORMA_PERFORMANCE_TARGET_TAG"'));
  assert.equal(workflow.jobs.pack.steps.find(row => row.id === 'pack').run, 'node scripts/candidate-scaffold.mjs pack "$RUNNER_TEMP/candidate artifacts"');
  assert.equal(workflow.jobs.pack.steps.at(-1).with.name, 'qualification-candidates');
  assert.equal(workflow.jobs.pack.steps.at(-1).with.path, '${{ runner.temp }}/candidate artifacts');
  const download = workflow.jobs.verify.steps.find(row => row.uses?.startsWith('actions/download-artifact@'));
  assert.deepEqual(download.with, { name: 'qualification-candidates', path: '${{ runner.temp }}/candidate artifacts', 'digest-mismatch': 'error' });
  assert.deepEqual(step(workflow, 'verify', authName).env, { RECORD_SHA256: '${{ needs.pack.outputs.record-sha256 }}' });
  const verify = step(workflow, 'verify', runName);
  assert.equal(verify.run.trim(), wholeCommand); assert.equal(verify['timeout-minutes'], 45);
  assert.deepEqual(verify.env, { GH_TOKEN: '${{ github.token }}' });
  assert(!workflow.jobs.verify.steps.some(row => /npm run build|release-set\.mjs pack|candidate-scaffold\.mjs pack/.test(row.run ?? '')));
  const retained = workflow.jobs.verify.steps.at(-1);
  assert.equal(retained.with.path.trim(), '${{ runner.temp }}/p17/\n${{ runner.temp }}/p17-owned/');
}

test('manual qualification uses original candidates, whole verifier, read-only permissions and owned failure retention', () => validate(actual));
test('publishing, source substitution, skipped verification, weakened time bounds and lost failure evidence are rejected', () => {
  for (const mutate of [
    w => { w.on.push = {}; }, w => { w.jobs.verify.permissions['id-token'] = 'write'; },
    w => { w.jobs.pack.environment = 'npm-publish'; }, w => { w.concurrency['cancel-in-progress'] = true; },
    w => { w.jobs.verify.steps[0].with.ref = 'main'; },
    w => { w.jobs.pack.steps.find(s => s.id === 'pack').run = 'cp -r old "$RUNNER_TEMP/candidate artifacts"'; },
    w => { step(w, 'verify', authName).env.RECORD_SHA256 = 'unbound'; },
    w => { step(w, 'verify', runName).if = 'false'; },
    w => { step(w, 'verify', runName)['continue-on-error'] = true; },
    w => { step(w, 'verify', runName).run = 'node scripts/verify-release-set.mjs old report.json'; },
    w => { step(w, 'verify', runName)['timeout-minutes'] = 90; },
    w => { w.jobs.verify.steps.at(-1).if = 'success()'; },
    w => { w.jobs.verify.steps.at(-1).with.path = '${{ runner.temp }}/p17/'; },
    w => { w.jobs.verify.steps.push({ run: 'npm publish' }); },
  ]) { const changed = structuredClone(actual); mutate(changed); assert.throws(() => validate(changed)); }
  assert.equal(P17_BUDGET_SECONDS, 1800);
  assert.equal(p17Time(1800).passed, true); assert.equal(p17Time(1800.001).passed, false);
});

// Execute the actual workflow's authentication body, with inert seven-file DS11
// fixtures. These controls do not pack, build, install, contact registries or run P17.
const auth = step(actual, 'verify', authName).run.match(/^node --input-type=module <<'NODE'\n([\s\S]*)\nNODE\n?$/)?.[1];
assert(auth, 'expected one inline Node authentication command');
function authenticate(version, mutate = () => {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'forma-qualification-input-'));
  try {
    const dir = join(temporary, 'candidate artifacts'); mkdirSync(dir);
    const contracts = JSON.parse(readFileSync(join(ROOT, 'scripts/release-contracts.json')));
    for (const gate of Object.values(contracts.milestones.rc.gates)) gate.status = 'pending';
    const set = { schema: 1, dryRun: true, commit: 'a'.repeat(40), run: '42', contracts,
      packages: [...CRATES.map(name => ({ name, path: `crates/${name}`, registry: 'crates' })),
        ...NPM.map(name => ({ name: `@getforma/${name}`, path: `packages/${name}`, registry: 'npm' }))]
        .map(row => ({ ...row, version, file: `${row.name.replace('@', '').replace('/', '-')}-${version}.${row.registry === 'crates' ? 'crate' : 'tgz'}` })) };
    for (const row of set.packages) { writeFileSync(join(dir, row.file), row.name); row.sha256 = digest(join(dir, row.file)); }
    writeFileSync(join(dir, 'Cargo.lock'), readFileSync(join(ROOT, 'Cargo.lock')));
    const env = { ...process.env, RUNNER_TEMP: temporary, GITHUB_SHA: set.commit, GITHUB_RUN_ID: set.run, FORMA_PERFORMANCE_TARGET_TAG: `v${version}` };
    mutate({ set, env, dir });
    writeFileSync(join(dir, 'release-set.json'), JSON.stringify(set));
    env.RECORD_SHA256 ??= digest(join(dir, 'release-set.json'));
    const result = spawnSync(process.execPath, ['--input-type=module'], { cwd: ROOT, env, input: auth, encoding: 'utf8' });
    return { result, set, env };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
test('the real DS11 check permits beta and pending RC rehearsals without a publication waiver', () => {
  for (const version of ['3.0.0-beta.3', '3.0.0-rc.1']) {
    const { result, set, env } = authenticate(version);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(assertReleaseSet(set.packages, `v${version}`), version);
    assert.deepEqual(performanceTarget(set, env), { tag: `v${version}`, rehearsal: true });
    if (version.includes('-rc')) assert.equal(releaseMilestone(set.contracts, version).ready, false);
  }
});
test('the real DS11 check refuses wrong source/run/target, modified archives/lock, missing package and live-record substitution', () => {
  for (const mutate of [
    ({ env }) => { env.GITHUB_SHA = 'b'.repeat(40); },
    ({ env }) => { env.GITHUB_RUN_ID = '43'; },
    ({ env }) => { env.RECORD_SHA256 = 'c'.repeat(64); },
    ({ env }) => { env.FORMA_PERFORMANCE_TARGET_TAG = 'v3.0.0-rc.1'; },
    ({ env }) => { env.FORMA_PERFORMANCE_TARGET_TAG = 'v3.0.0-beta.3; echo injected'; },
    ({ set }) => { set.packages.pop(); },
    ({ set }) => { set.packages[6].version = '3.0.0-beta.2'; },
    ({ set }) => { set.dryRun = false; },
    ({ set, dir }) => { writeFileSync(join(dir, set.packages[0].file), 'altered'); },
    ({ dir }) => { writeFileSync(join(dir, 'Cargo.lock'), 'altered'); },
  ]) {
    const { result } = authenticate('3.0.0-beta.3', mutate);
    assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /AssertionError/);
  }
});
