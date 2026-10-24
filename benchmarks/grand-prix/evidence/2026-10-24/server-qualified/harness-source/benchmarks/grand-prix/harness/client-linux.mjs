import { createCampaign } from './campaign.mjs';
// Sequential baseline/candidate client and signals races on one Linux host.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, statfsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { hostProfile, validateEngineProfile, validateContainerResources } from './resource-profile.mjs';
import { SIGNAL_CONTROL, SIGNAL_RUNS, SIGNAL_WARMUPS, describeSignalControl, validateSignalControl } from './client-signals-control.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
const argv = process.argv.slice(2);
const option = (key, fallback) => argv.includes(`--${key}`) ? argv[argv.indexOf(`--${key}`) + 1] : fallback;
assert.equal(process.platform, 'linux', 'native Linux required');
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim(), '', 'commit source before racing');
const diagnostic = argv.includes('--diagnostic');
const resourceProfile = hostProfile({ diagnostic });
validateEngineProfile(resourceProfile, JSON.parse(execFileSync('docker', ['info', '--format', '{{json .}}'], { encoding: 'utf8' })));
const chrome = resolve(option('chrome', process.env.CHROME_PATH ?? ''));
const chromeHash = option('chrome-sha256', process.env.CHROME_SHA256);
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
assert(/^[a-f0-9]{64}$/.test(chromeHash ?? ''), 'locked Chromium SHA-256 required');
assert.equal(sha(chrome), chromeHash, 'Chromium executable changed');
const refs = option('forma-refs', '').split(',').filter(Boolean);
assert(refs.every(ref => /^[a-f0-9]{40}$/.test(ref)) && new Set(refs).size === refs.length, 'candidate refs must be unique exact commits');
const id = process.env.GP_RUN_ID || `client-${Date.now().toString(36)}`;
assert(/^[a-z0-9-]+$/.test(id));
process.env.GP_RUN_ID = id;
const results = join(root, 'results');
mkdirSync(results, { recursive: true });
const work = join(results, `${id}-client`);
assert(!existsSync(work), 'fresh evidence directory required');
mkdirSync(work);
const campaignFile = join(work, 'campaign.json');
const campaign = createCampaign(campaignFile);
const report = { schema: 1, id, campaign, diagnostic, qualifiedProfile: !diagnostic, resourceProfile, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  chromeHash, cpu: os.cpus()[0]?.model, cpus: os.availableParallelism(), kernel: os.release(), memoryBytes: os.totalmem(),
  before: new Date().toISOString(), trials: [], passed: false };
const save = () => writeFileSync(join(work, 'run.json'), JSON.stringify(report, null, 2) + '\n');
const profileFile = join(work, 'resource-profile.json');
writeFileSync(profileFile, JSON.stringify(resourceProfile, null, 2) + '\n');
const label = `gp264run=${id}`;
const builder = `gp264-${id}`;
const ownership = { id, builder, builderCreated: false };
const ownershipPath = join(results, `${id}-ownership.json`);
assert(!existsSync(ownershipPath), 'run ID already used');
let child, stopping = false;
function run(program, args, cwd = root) {
  console.log(JSON.stringify([program, ...args]));
  return new Promise((ok, fail) => {
    child = spawn(program, args, { cwd, stdio: 'inherit', env: process.env });
    child.once('error', fail);
    child.once('close', code => { child = undefined; code === 0 ? ok() : fail(Error(`${program} exited ${code}`)); });
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(signal); });
function machine() {
  const disk = statfsSync(root);
  return { at: new Date().toISOString(), load: os.loadavg(), freeBytes: disk.bavail * disk.bsize,
    cpuPressure: readFileSync('/proc/pressure/cpu', 'utf8') };
}
async function quiet() {
  const deadline = Date.now() + 300_000;
  while (os.loadavg()[0] >= 2 && Date.now() < deadline && !stopping) await new Promise(resolve => setTimeout(resolve, 10_000));
  assert(!stopping && os.loadavg()[0] < 2, 'machine did not settle');
  assert(machine().freeBytes >= 4 * 1024 ** 3, 'less than 4 GiB free');
}
function archive(ref, paths, dest) {
  mkdirSync(dest);
  const bytes = execFileSync('git', ['archive', ref, ...paths], { cwd: repository, maxBuffer: 128 * 1024 ** 2 });
  execFileSync('tar', ['-xf', '-', '-C', dest], { input: bytes });
}
try {
  report.freeBefore = machine().freeBytes;
  await run('docker', ['buildx', 'create', '--name', builder, '--driver', 'docker-container']);
  ownership.builderCreated = true; writeFileSync(ownershipPath, JSON.stringify(ownership));
  for (const ref of ['published', ...refs]) {
    const trialDir = join(work, ref); mkdirSync(trialDir);
    mkdirSync(join(trialDir, 'harness'));
    cpSync(join(root, 'harness/resource-profile.mjs'), join(trialDir, 'harness/resource-profile.mjs'));
    cpSync(join(root, 'harness/campaign.mjs'), join(trialDir, 'harness/campaign.mjs'));
    const client = join(trialDir, 'client-race'), signals = join(trialDir, 'signals-race');
    for (const [source, dest] of [['client-race', client], ['signals-race', signals]]) {
      cpSync(join(root, source), dest, { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|dist|results)(?:\/|$)/.test(path.slice(join(root, source).length)) });
    }
    cpSync(join(root, 'harness/resource-profile.mjs'), join(signals, 'resource-profile.mjs'));
    cpSync(join(root, 'harness/campaign.mjs'), join(signals, 'campaign.mjs'));
    const signalDockerfile = join(signals, 'Dockerfile');
    writeFileSync(signalDockerfile, readFileSync(signalDockerfile, 'utf8') + '\nCOPY resource-profile.mjs /gp/harness/resource-profile.mjs\nCOPY campaign.mjs /gp/harness/campaign.mjs\n');
    await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], client);
    const publishedPackage = JSON.parse(readFileSync(join(client, 'node_modules/@getforma/core/package.json'), 'utf8'));
    let corePackage = publishedPackage;
    let core;
    if (ref !== 'published') {
      const candidate = join(trialDir, 'candidate');
      await run('git', ['fetch', 'origin', ref], repository);
      archive(ref, ['package.json', 'package-lock.json', 'packages', 'scripts'], candidate);
      await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], candidate);
      await run('npm', ['run', 'build', '--workspace', '@getforma/core'], candidate);
      core = join(candidate, 'packages/core');
      const candidatePackage = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
      corePackage = candidatePackage;
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
        assert.deepEqual(candidatePackage[field] ?? {}, publishedPackage[field] ?? {}, `candidate changed ${field}; review the locked benchmark dependency graph before racing`);
      }
      for (const dest of [join(client, 'node_modules/@getforma/core'), join(signals, 'candidate-core')]) {
        mkdirSync(dest, { recursive: true });
        cpSync(join(core, 'package.json'), join(dest, 'package.json'));
        rmSync(join(dest, 'dist'), { recursive: true, force: true });
        cpSync(join(core, 'dist'), join(dest, 'dist'), { recursive: true });
      }
      const dockerfile = join(signals, 'Dockerfile');
      writeFileSync(dockerfile, readFileSync(dockerfile, 'utf8') + '\nCOPY candidate-core node_modules/@getforma/core\n');
    }
    const cars = ref === 'published' ? ['forma', 'vanilla', 'react', 'preact', 'solid', 'svelte', 'vue'] : ['forma', 'vanilla'];
    for (const car of cars) await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', `apps/${car}`, '--config', `apps/${car}/vite.config.js`], client);
    const signalImage = `gp264/${id}/signals-${ref}`;
    const signalVersionControl = describeSignalControl(JSON.parse(readFileSync(join(signals, 'package-lock.json'), 'utf8')),
      corePackage, sha(join(signals, 'adapters', `${SIGNAL_CONTROL}.mjs`)));
    await run('docker', ['buildx', 'build', '--builder', builder, '--load', '--label', 'grandprix=forma-264', '--label', label, '-t', signalImage, signals]);
    const trial = { ref, cars, resourceProfile, campaign, clientLock: sha(join(client, 'package-lock.json')), signalsLock: sha(join(signals, 'package-lock.json')),
      coreBundle: sha(join(client, 'node_modules/@getforma/core/dist/index.js')),
      signalsImage: JSON.parse(execFileSync('docker', ['image', 'inspect', signalImage], { encoding: 'utf8' }))[0].Id, signalVersionControl,
      before: machine(), passed: false };
    report.trials.push(trial); save();
    await quiet();
    assert.equal(sha(chrome), chromeHash);
    const raw = join(trialDir, 'raw'); mkdirSync(raw);
    const browserArgs = ['run.mjs', '--cars', cars.join(','), '--chrome', chrome, '--runs', '5', '--warmups', '2', '--out', join(raw, 'dom'), '--resource-profile', profileFile, '--campaign', campaignFile];
    if (resourceProfile.browser.cpuset) await run('taskset', ['--cpu-list', resourceProfile.browser.cpuset, process.execPath, ...browserArgs], client);
    else await run(process.execPath, browserArgs, client);
    await run(process.execPath, ['bundle.mjs', '--cars', cars.join(','), '--out', join(raw, 'bundle'), '--resource-profile', profileFile, '--campaign', campaignFile], client);
    await quiet();
    // Official rankings retain their five cars. The exact engine reference is a
    // separate sequential container from the same image, with identical resources.
    for (const control of [false, true]) {
      const signalOut = join(raw, control ? 'signals-version-check' : 'signals'); mkdirSync(signalOut);
      const signalContainer = execFileSync('docker', ['create', '--label', 'grandprix=forma-264', '--label', label, '--cpus=1', '--memory=1g',
        ...(resourceProfile.signals.cpuset ? [`--cpuset-cpus=${resourceProfile.signals.cpuset}`] : []),
        '-e', `GP_RESOURCE_PROFILE=${JSON.stringify(resourceProfile)}`, '-e', `GP_CAMPAIGN_JSON=${JSON.stringify(campaign)}`, '-v', `${signalOut}:/out`, signalImage,
        '--runs', String(SIGNAL_RUNS), '--warmups', String(SIGNAL_WARMUPS), ...(control ? ['--cars', SIGNAL_CONTROL] : [])], { encoding: 'utf8' }).trim();
      try {
        const inspected = JSON.parse(execFileSync('docker', ['inspect', signalContainer], { encoding: 'utf8' }))[0];
        validateContainerResources(inspected, resourceProfile.signals);
        const container = { id: inspected.Id, image: inspected.Image, nanoCpus: inspected.HostConfig.NanoCpus, memoryBytes: inspected.HostConfig.Memory, cpuset: inspected.HostConfig.CpusetCpus };
        if (control) trial.signalVersionControl.container = container;
        else trial.signalsContainer = container;
        await run('docker', ['start', '--attach', signalContainer]);
        const finished = JSON.parse(execFileSync('docker', ['inspect', signalContainer], { encoding: 'utf8' }))[0];
        assert.equal(finished.State.ExitCode, 0, 'signals race failed inside the container');
        if (control) {
          const resultPath = join(signalOut, `${SIGNAL_CONTROL}.json`);
          validateSignalControl(JSON.parse(readFileSync(resultPath, 'utf8')), signalVersionControl, resourceProfile, campaign);
          trial.signalVersionControl.resultSha256 = sha(resultPath);
        }
      } finally { await run('docker', ['rm', '-f', signalContainer]); }
    }
    trial.after = machine(); trial.passed = true; save();
    await run('docker', ['image', 'rm', signalImage]);
    await run('docker', ['buildx', 'prune', '--builder', builder, '--all', '--force']);
  }
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  try { await run(process.execPath, ['harness/cleanup.mjs']); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  report.finished = new Date().toISOString(); report.freeAfter = machine().freeBytes; save();
}
