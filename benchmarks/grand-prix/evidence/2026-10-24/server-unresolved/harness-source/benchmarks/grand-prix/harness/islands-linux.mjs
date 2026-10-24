import { createCampaign } from './campaign.mjs';
// Sequential native Linux island qualification. Every Docker resource is run-owned.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostProfile, validateEngineProfile, validateContainerResources } from './resource-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CARS = ['forma', 'react-node', 'react-bun', 'react-deno', 'preact-node', 'solid-node',
  'svelte-node', 'vue-node', 'next', 'react-router', 'astro'];
const lock = JSON.parse(readFileSync(new URL('./chromium-linux-lock.json', import.meta.url), 'utf8'));
const validDigest = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');

export function archiveContestants(directory, sourceCommit) {
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'exact source commit required');
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  mkdirSync(directory);
  // git archive still applies the working directory prefix to an explicit tree.
  // Run at the repository root so this subtree archive actually includes its cars.
  const archive = execFileSync('git', ['archive', `${sourceCommit}:benchmarks/grand-prix/contestants`],
    { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive });
}

/** The URL is derived from this exact owned container, never supplied separately. */
export function inspectedIslandUrl(container, { runId, imageId, resourceProfile }) {
  assert.equal(container.State?.Running, true, 'island container is not running');
  assert.equal(container.Config?.Labels?.grandprix, 'forma-264', 'foreign round');
  assert.equal(container.Config?.Labels?.gp264run, runId, 'foreign run');
  assert(validDigest(imageId), 'full image identity required');
  assert.equal(container.Image, imageId, 'container is running another image');
  assert.equal(container.HostConfig?.NanoCpus, 1e9, 'island server requires exactly one CPU');
  assert.equal(container.HostConfig?.Memory, 1073741824, 'island server requires exactly 1 GiB');
  if (resourceProfile) validateContainerResources(container, resourceProfile.classA);
  const bindings = container.NetworkSettings?.Ports?.['3000/tcp'];
  assert.equal(bindings?.length, 1, 'expected one published server port');
  assert.equal(bindings[0].HostIp, '127.0.0.1', 'server must bind only loopback');
  assert(/^\d+$/.test(bindings[0].HostPort), 'invalid server port');
  const port = Number(bindings[0].HostPort);
  assert(port > 0 && port <= 65535, 'invalid server port');
  return `http://127.0.0.1:${port}`;
}

function treeLocks(directory, prefix = '') {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = join(prefix, entry.name), absolute = join(directory, entry.name);
    if (entry.isDirectory()) return Object.entries(treeLocks(absolute, relative));
    if (!entry.isFile() || !/^(?:package(?:-lock)?\.json|Cargo\.(?:lock|toml)|deno\.(?:json|lock))$/.test(entry.name)) return [];
    return [[relative, createHash('sha256').update(readFileSync(absolute)).digest('hex')]];
  }));
}

export async function main(argv = process.argv.slice(2)) {
  const option = (name, fallback) => argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback;
  const diagnostic = argv.includes('--diagnostic');
  const cars = option('cars', CARS.join(',')).split(',');
  assert(cars.length && new Set(cars).size === cars.length && cars.every(car => CARS.includes(car)), 'invalid car set');
  assert.equal(process.platform, 'linux', 'island orchestration requires native Linux');
  assert.equal(process.arch, lock.arch, 'frozen browser architecture differs');
  const resourceProfile = hostProfile({ diagnostic });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'commit all source before racing');
  const sourceCommit = git('rev-parse', 'HEAD');
  const chrome = option('chrome', undefined);
  assert(chrome && existsSync(chrome), '--chrome must identify the frozen executable');
  const browserHash = createHash('sha256');
  for await (const chunk of createReadStream(chrome)) browserHash.update(chunk);
  assert.equal(browserHash.digest('hex'), lock.executableSha256, 'browser does not match committed executable pin');
  const id = process.env.GP_RUN_ID || `islands-${Date.now().toString(36)}-${process.pid}`;
  assert(/^[a-z0-9-]+$/.test(id), 'invalid run ID');
  process.env.GP_RUN_ID = id;
  const builder = `gp264-${id}`, label = `gp264run=${id}`, network = `gp264-islands-${id}`;
  const results = join(root, 'results'), output = join(results, `islands-${id}`);
  mkdirSync(results, { recursive: true });
  assert(!existsSync(output) && !existsSync(join(results, `${id}-ownership.json`)), 'fresh run ID required');
  mkdirSync(output);
  const campaignFile = join(output, 'campaign.json');
  const campaign = createCampaign(campaignFile);
  const ownershipPath = join(results, `${id}-ownership.json`);
  const ownership = { id, builder, builderCreated: false };
  const free = () => { const stat = statfsSync(root); return stat.bavail * stat.bsize; };
  const checkDisk = () => assert(free() >= 4 * 1024 ** 3, 'free disk below 4 GiB; stop the run');
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
  const machine = () => ({ at: new Date().toISOString(), platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model, availableCpus: os.availableParallelism(), kernel: os.release(),
    memoryBytes: os.totalmem(), load: os.loadavg(), freeBytes: free(),
    cpuPressure: existsSync('/proc/pressure/cpu') ? readFileSync('/proc/pressure/cpu', 'utf8') : null });
  const engine = JSON.parse(docker('info', '--format', '{{json .}}'));
  validateEngineProfile(resourceProfile, engine);
  const report = { schema: 1, protocol: 'forma-264-island-v1', id, campaign, diagnostic, qualifiedProfile: !diagnostic,
    sourceCommit, cars, resourceProfile, browser: lock, engine: { version: engine.ServerVersion, os: engine.OperatingSystem,
      kernel: engine.KernelVersion, cpus: engine.NCPU, memoryBytes: engine.MemTotal },
    before: machine(), steps: [], failures: [], passed: false };
  const save = () => writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2) + '\n');
  const profileFile = join(output, 'resource-profile.json');
  writeFileSync(profileFile, JSON.stringify(resourceProfile, null, 2) + '\n');
  let active, stopping = false;
  const onSignal = signal => { stopping = true; active?.kill(signal); };
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => onSignal(signal)]));
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  const run = (program, args) => new Promise((ok, fail) => {
    console.log(JSON.stringify([program, ...args]));
    active = spawn(program, args, { cwd: root, stdio: 'inherit', env: process.env });
    active.once('error', fail);
    active.once('close', code => { active = undefined; code === 0 ? ok() : fail(new Error(`${program} exited ${code}`)); });
  });
  const quiet = async () => {
    const deadline = Date.now() + 5 * 60_000;
    while (!stopping && os.loadavg()[0] >= 2 && Date.now() < deadline) {
      console.log(`settling after build: load ${os.loadavg()[0].toFixed(2)}`);
      await new Promise(resolve => setTimeout(resolve, 10_000));
    }
    assert(!stopping, 'run interrupted');
    assert(os.loadavg()[0] < 2, 'machine did not settle below load 2');
  };
  save();
  try {
    checkDisk();
    const contexts = join(output, 'contexts'); archiveContestants(contexts, sourceCommit);
    await run('docker', ['buildx', 'create', '--name', builder, '--driver', 'docker-container']);
    ownership.builderCreated = true; writeFileSync(ownershipPath, JSON.stringify(ownership));
    docker('network', 'create', '--label', 'grandprix=forma-264', '--label', label, network);
    for (const car of cars) {
      assert(!stopping, 'run interrupted'); checkDisk();
      const image = `gp264/${id}/${car}`, step = { car, sourceCommit, locks: treeLocks(join(contexts, car)), passed: false };
      report.steps.push(step); save();
      let containerId;
      try {
        await run('docker', ['buildx', 'build', '--builder', builder, '--load', '--label', 'grandprix=forma-264',
          '--label', label, '--label', `org.opencontainers.image.revision=${sourceCommit}`, '-t', image, join(contexts, car)]);
        checkDisk();
        const imageInfo = JSON.parse(docker('image', 'inspect', image))[0];
        step.image = { id: imageInfo.Id, sizeBytes: imageInfo.Size, architecture: imageInfo.Architecture };
        assert(validDigest(step.image.id), 'full image digest required');
        await quiet(); step.before = machine();
        containerId = docker('run', '-d', '--name', `gp264-${id}-${car}`, '--label', 'grandprix=forma-264', '--label', label,
          '--network', network, '--cpus=1', '--memory=1g', '-e', 'GP_WORKERS=1', '-e', 'NODE_ENV=production',
          ...(resourceProfile.classA.cpuset ? [`--cpuset-cpus=${resourceProfile.classA.cpuset}`] : []),
          '-p', '127.0.0.1::3000', image);
        const inspected = JSON.parse(docker('inspect', containerId))[0];
        const url = inspectedIslandUrl(inspected, { runId: id, imageId: step.image.id, resourceProfile });
        step.container = { id: inspected.Id, url, nanoCpus: inspected.HostConfig.NanoCpus, memoryBytes: inspected.HostConfig.Memory, cpuset: inspected.HostConfig.CpusetCpus };
        let ready = false;
        for (const deadline = Date.now() + 60_000; Date.now() < deadline && !stopping;) {
          try { const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) }); ready = response.status === 200 && (await response.text()).trim() === 'ok'; } catch {}
          if (ready) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(ready && !stopping, 'server did not become healthy');
        const raw = join(output, `${car}.json`);
        const args = ['island-race/run.mjs', '--car', car, '--url', url, '--chrome', chrome,
          '--chrome-sha256', lock.executableSha256, '--container-id', containerId, '--commit', sourceCommit, '--out', raw, '--resource-profile', profileFile, '--campaign', campaignFile];
        if (diagnostic) args.push('--diagnostic');
        if (resourceProfile.browser.cpuset) await run('taskset', ['--cpu-list', resourceProfile.browser.cpuset, process.execPath, ...args]);
        else await run(process.execPath, args);
        const measured = JSON.parse(readFileSync(raw, 'utf8'));
        assert.equal(measured.verified, true); assert.equal(measured.qualifiedProfile, !diagnostic);
        assert.deepEqual(measured.resourceProfile, resourceProfile);
        assert.deepEqual(measured.campaign, campaign);
        assert.equal(measured.sourceCommit, sourceCommit); assert.equal(measured.browser.sha256, lock.executableSha256);
        step.passed = true;
      } catch (error) { step.error = String(error); console.error(step.error); report.failures.push({ car, error: step.error }); }
      finally {
        if (containerId) { step.serverLog = docker('logs', containerId); docker('rm', '-f', containerId); }
        step.after = machine(); save();
      }
      // The builder belongs to this run. Never prune a default/shared builder.
      if (step.image) docker('image', 'rm', image);
      await run('docker', ['buildx', 'prune', '--builder', builder, '--all', '--force']);
      checkDisk();
    }
    assert(!stopping, 'run interrupted');
    report.passed = report.failures.length === 0 && report.steps.length === cars.length;
  } catch (error) { report.error = String(error); console.error(report.error); report.passed = false; }
  finally {
    try { await run(process.execPath, ['harness/cleanup.mjs']); }
    catch (error) { report.cleanupError = String(error); report.passed = false; }
    report.after = machine(); save();
    for (const [signal, handler] of Object.entries(handlers)) process.removeListener(signal, handler);
  }
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
