// Research transport only. The canonical DOM timing and bundle collectors are unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, statfsSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { hostProfile } from '../../harness/resource-profile.mjs';
import { createCampaign } from '../../harness/campaign.mjs';

const fixture = dirname(fileURLToPath(import.meta.url));
const root = resolve(fixture, '../..');
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(sourceCommit, process.env.GITHUB_SHA, 'workflow checkout identity differs');
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(), '', 'committed research source required');
assert.equal(process.env.GP_DIAGNOSTIC, 'false', 'this fixed follow-up requires an explicitly qualified profile');
assert.equal(process.env.GP_PROFILE, 'gha-4-v1');
const profile = hostProfile({ diagnostic: false });
const manifest = JSON.parse(readFileSync(join(fixture, 'fixture.json'), 'utf8'));
assert.equal(manifest.schema, 1); assert.equal(manifest.researchOnly, true); assert.equal(manifest.shipsInProduct, false);
assert.deepEqual(manifest.measuredCars, ['forma-baseline', 'forma-delegated', 'vanilla']);
assert.deepEqual(manifest.controlCars, ['contract-control', 'ownership-supplement']);
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function verifyInputs() {
  for (const f of manifest.files) {
    const path = resolve(fixture, f.path);
    assert(path.startsWith(fixture + sep), 'fixture path escapes its root');
    assert.equal(readFileSync(path).length, f.bytes, f.path);
    assert.equal(sha(path), f.sha256, f.path);
  }
  for (const [path, digest] of Object.entries(manifest.harnessFiles)) assert.equal(sha(join(root, path)), digest, path);
  for (const [path, digest] of Object.entries(manifest.repositoryFiles)) assert.equal(sha(join(repo, path)), digest, path);
}
verifyInputs();
const lock = JSON.parse(readFileSync(join(root, 'harness/chromium-linux-lock.json'), 'utf8'));
const chrome = resolve(process.env.CHROME_PATH ?? '');
assert.equal(sha(chrome), lock.executableSha256, 'browser differs from pinned executable');
const id = process.env.GP_RUN_ID;
assert(/^[a-z0-9-]+$/.test(id ?? ''), 'scoped run ID required');
const work = join(root, 'results', `${id}-research`);
assert(!existsSync(work), 'evidence must not be overwritten');
mkdirSync(work, { recursive: true });
const campaignFile = join(work, 'campaign.json');
const campaign = createCampaign(campaignFile);
const profileFile = join(work, 'resource-profile.json');
writeFileSync(profileFile, JSON.stringify(profile, null, 2) + '\n');
const report = { schema: 1, kind: 'forma-294-exact-prebuilt-csr-research', researchOnly: true,
  shippedProductAcceptance: false, sourceCommit, coreSource: manifest.coreSource, id, campaign,
  resourceProfile: profile, fixtureSha256: sha(join(fixture, 'fixture.json')), chromeSha256: sha(chrome),
  node: process.version, kernel: os.release(), machine: os.cpus()[0]?.model,
  startedAt: new Date().toISOString(), passed: false, commands: [], raw: {} };
const save = () => writeFileSync(join(work, 'run.json'), JSON.stringify(report, null, 2) + '\n');
save();
let child, stopped = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopped = true;
  if (child?.pid) child.kill(signal); // Interrupt the supervisor; it owns worker descendants.
});
function run(program, args, cwd) {
  assert(!stopped, 'run interrupted');
  const receipt = join(work, 'owned', String(report.commands.length + 1));
  const supervisor = join(work, 'harness', 'release-owned-linux.py');
  const supervisorArgs = ['--cpu-list', String(profile.selectedCpus[0]), 'python3', supervisor,
    receipt, '900', '--', program, ...args];
  // The unchanged subreaper stays on the reserved CPU; the browser collector
  // explicitly selects its original three-CPU allocation inside this command.
  report.commands.push({ program, args, cwd, supervisor, supervisorArgs, receipt }); save();
  return new Promise((ok, fail) => {
    child = spawn('taskset', supervisorArgs, { cwd, stdio: 'inherit', env: process.env, detached: true });
    child.once('error', fail);
    child.once('close', code => {
      child = undefined;
      try {
        const ownership = JSON.parse(readFileSync(join(receipt, 'supervisor.json'), 'utf8'));
        assert(code === 0 && !stopped && ownership.complete && ownership.cleanup.complete);
        assert.equal(ownership.exitCode, 0); assert.deepEqual(ownership.faults, []);
        assert.deepEqual(ownership.cleanup.failures, []);
        assert.deepEqual(ownership.cleanup.remainingOwnedPids, []);
        ok();
      } catch (error) { fail(Error(`${program} ownership/run failure: ${error}`)); }
    });
  });
}
async function quiet() {
  const deadline = Date.now() + 300_000;
  while (!stopped && os.loadavg()[0] >= 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10_000));
  assert(!stopped && os.loadavg()[0] < 2, 'host did not settle');
  const disk = statfsSync(root); assert(disk.bavail * disk.bsize >= 4 * 1024 ** 3, 'less than4GiB free');
}
try {
  const race = join(work, 'race'), raw = join(work, 'raw');
  mkdirSync(race); mkdirSync(raw); mkdirSync(join(work, 'harness')); mkdirSync(join(work, 'owned'));
  cpSync(join(repo, 'scripts/release-owned-linux.py'), join(work, 'harness', 'release-owned-linux.py'));
  for (const file of ['run.mjs', 'lib.mjs', 'timing.mjs', 'bundle.mjs']) cpSync(join(root, 'client-race', file), join(race, file));
  cpSync(join(fixture, 'check-controls.mjs'), join(race, 'check-controls.mjs'));
  for (const file of ['resource-profile.mjs', 'campaign.mjs']) cpSync(join(root, 'harness', file), join(work, 'harness', file));
  // Only browser tooling is installed. Framework/compiler/runtime bytes are never rebuilt.
  symlinkSync(join(root, 'island-race/node_modules'), join(race, 'node_modules'), 'dir');
  for (const car of [...manifest.measuredCars, ...manifest.controlCars]) {
    const destination = join(race, 'apps', car, 'dist'); mkdirSync(destination, { recursive: true });
    cpSync(join(fixture, 'assets', car), destination, { recursive: true });
  }
  cpSync(join(fixture, 'fixture.json'), join(work, 'fixture.json'));
  cpSync(join(fixture, 'source'), join(work, 'source'), { recursive: true });
  cpSync(join(fixture, 'licenses'), join(work, 'licenses'), { recursive: true });
  cpSync(join(fixture, 'CONTRACT.md'), join(work, 'CONTRACT.md'));
  cpSync(join(fixture, 'package-provenance.json'), join(work, 'package-provenance.json'));
  const verifyStaged = () => {
    for (const file of manifest.files.filter(f => f.path.startsWith('assets/'))) {
      const [, car, ...parts] = file.path.split('/');
      assert.equal(sha(join(race, 'apps', car, 'dist', ...parts)), file.sha256, file.path);
    }
  };
  verifyStaged();
  const affine = args => run('taskset', ['--cpu-list', profile.browser.cpuset, process.execPath, ...args], race);
  await affine(['check-controls.mjs', race, chrome, profileFile, join(raw, 'controls.json')]);
  await quiet(); verifyInputs(); verifyStaged(); assert.equal(sha(chrome), lock.executableSha256);
  report.beforeTiming = { at: new Date().toISOString(), load: os.loadavg(), pressure: readFileSync('/proc/pressure/cpu', 'utf8') }; save();
  await affine(['run.mjs', '--cars', manifest.measuredCars.join(','), '--runs', '5', '--warmups', '2',
    '--chrome', chrome, '--out', join(raw, 'dom'), '--resource-profile', profileFile, '--campaign', campaignFile]);
  report.afterTiming = { at: new Date().toISOString(), load: os.loadavg(), pressure: readFileSync('/proc/pressure/cpu', 'utf8') };
  await run(process.execPath, ['bundle.mjs', '--cars', manifest.measuredCars.join(','), '--out', join(raw, 'bundle'),
    '--resource-profile', profileFile, '--campaign', campaignFile], race);
  verifyInputs(); verifyStaged(); assert.equal(sha(chrome), lock.executableSha256);
  for (const car of manifest.measuredCars) {
    const dom = join(raw, 'dom', `${car}.json`), bundle = join(raw, 'bundle', `${car}.json`);
    const result = JSON.parse(readFileSync(dom, 'utf8'));
    assert(result.verified && result.runs === 5 && result.warmups === 2 && Object.keys(result.ops).length === 9);
    assert.deepEqual(result.campaign, campaign); assert.deepEqual(result.resourceProfile, profile);
    const size = JSON.parse(readFileSync(bundle, 'utf8'));
    assert.deepEqual(size.campaign, campaign); assert.deepEqual(size.resourceProfile, profile);
    assert(size.bytes > 0 && size.gzip > 0 && size.brotli > 0);
    report.raw[car] = { domSha256: sha(dom), bundleSha256: sha(bundle) };
  }
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); }
