import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, copyFileSync, rmSync, existsSync, openSync, closeSync } from 'node:fs';
import os from 'node:os';
import { createCampaign } from '../grand-prix/harness/campaign.mjs';
import { SOURCES, SEQUENCE, HARNESS, HARNESS_SHA256, MEMORY_BYTES, fileHash, allocation, ownedUnit, validateResult, validateLaunch, summarize } from './protocol.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const require = createRequire(import.meta.url);
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const capture = (command, args, cwd = repo) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 }).trim();
export function inventory(root) {
  const out = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name), stat = lstatSync(file);
      assert(!stat.isSymbolicLink(), 'artifact contains a symbolic link');
      if (stat.isDirectory()) walk(file);
      else { assert(stat.isFile()); out.push({ path: relative(root, file), bytes: stat.size, sha256: fileHash(file) }); }
    }
  }
  walk(root); return out;
}
export async function command(command, args, cwd, stem, env = process.env, timeoutMs = 15 * 60 * 1000) {
  const out = openSync(stem + '.stdout', 'wx'), err = openSync(stem + '.stderr', 'wx');
  const startedAt = new Date().toISOString();
  let timer, child, timedOut = false, result, spawnError;
  try {
    result = await new Promise((resolveResult, reject) => {
      child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', out, err] });
      timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveResult({ code, signal }));
    });
    assert.equal(timedOut, false, `command timed out; retained ${stem}`);
    assert.equal(result.code, 0, `command failed; retained ${stem}`);
  } catch (error) { spawnError = error.message; throw error; }
  finally {
    clearTimeout(timer); closeSync(out); closeSync(err);
    json(stem + '.command.json', { command, args, cwd, startedAt, finishedAt: new Date().toISOString(), timedOut, ...result, error: spawnError ?? null });
  }
}
export function cleanupUnit(unit, campaignId, execute = capture) {
  const expected = ownedUnit(unit, campaignId), name = unit + '.service';
  const listed = execute('sudo', ['-n', 'systemctl', 'list-units', '--all', '--full', '--plain', '--no-legend', name]);
  if (!listed) return { unit, absent: true };
  assert.equal(listed.trim().split(/\s+/)[0], name, 'unexpected service lookup');
  const description = execute('sudo', ['-n', 'systemctl', 'show', name, '--property=Description', '--value']);
  assert.equal(description, expected, 'refuse to stop a foreign unit');
  execute('sudo', ['-n', 'systemctl', 'stop', name]);
  const after = execute('sudo', ['-n', 'systemctl', 'list-units', '--all', '--full', '--plain', '--no-legend', name]);
  if (!after) return { unit, absent: false, absentAfterStop: true };
  const fields = after.trim().split(/\s+/);
  assert.equal(fields[0], name);
  assert(!['active', 'activating', 'deactivating'].includes(fields[2]), 'owned service remains active');
  return { unit, absent: false, active: fields[2] };
}
function actualRunnerTemp() {
  assert(process.env.RUNNER_TEMP, 'RUNNER_TEMP required for cleanup');
  return realpathSync(process.env.RUNNER_TEMP);
}
export function cleanupOwned(state, execute = capture, runnerTemp = actualRunnerTemp()) {
  assert.deepEqual(Object.keys(state).sort(), ['campaignId', 'runnerTemp', 'units', 'work']);
  assert.equal(state.runnerTemp, runnerTemp, 'receipt differs from actual RUNNER_TEMP');
  assert.equal(dirname(state.work), runnerTemp, 'temporary tree escaped actual runner temp');
  assert.deepEqual(state.units, SEQUENCE.map((_, i) => `forma-adoption-${state.campaignId}-${i}`), 'receipt unit sequence changed');
  for (const unit of state.units) ownedUnit(unit, state.campaignId);
  assert(/^forma-adoption-[A-Za-z0-9]+$/.test(state.work.split('/').at(-1)), 'foreign temporary tree');
  if (existsSync(state.work)) {
    assert(lstatSync(state.work).isDirectory() && !lstatSync(state.work).isSymbolicLink(), 'temporary tree must be a real directory');
    assert.equal(realpathSync(state.work), state.work, 'temporary tree path changed');
    assert.equal(readFileSync(join(state.work, '.owner'), 'utf8'), state.campaignId, 'temporary tree ownership changed');
  }
  const outcomes = [], errors = [];
  for (const unit of state.units) {
    try { outcomes.push(cleanupUnit(unit, state.campaignId, execute)); }
    catch (error) { errors.push({ unit, error: error.message }); }
  }
  if (existsSync(state.work) && !errors.length) rmSync(state.work, { recursive: true });
  return { outcomes, errors, temporaryTreeRemoved: !existsSync(state.work) };
}
function playwrightIdentity(root) {
  const resolveFrom = createRequire(join(root, 'package.json'));
  const packages = Object.fromEntries(['@playwright/test', 'playwright', 'playwright-core'].map(name => {
    const path = resolveFrom.resolve(name + '/package.json');
    return [name, { version: JSON.parse(readFileSync(path)).version, packageJsonSha256: fileHash(path) }];
  }));
  const registryFile = join(dirname(resolveFrom.resolve('playwright-core/package.json')), 'browsers.json');
  return { packages, registrySha256: fileHash(registryFile) };
}
async function main(output) {
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v24.22.0');
  assert(!process.env.NODE_OPTIONS, 'ambient Node options are not allowed');
  assert(process.env.RUNNER_TEMP && process.env.PLAYWRIGHT_BROWSERS_PATH, 'owned CI paths required');
  const resources = allocation(readFileSync('/proc/self/status', 'utf8'), os.availableParallelism(), process.platform, process.env.GITHUB_ACTIONS);
  assert(!existsSync(output), 'output already exists'); mkdirSync(output, { recursive: true });
  const campaign = createCampaign(join(output, 'campaign.json'));
  const work = mkdtempSync(join(realpathSync(process.env.RUNNER_TEMP), 'forma-adoption-'));
  writeFileSync(join(work, '.owner'), campaign.id, { flag: 'wx' });
  const state = { campaignId: campaign.id, work, runnerTemp: dirname(work), units: SEQUENCE.map((_, i) => `forma-adoption-${campaign.id}-${i}`) };
  json(join(output, 'ownership.json'), state);
  const run = { schema: 1, campaign, resources, sources: SOURCES, sequence: SEQUENCE, builds: {}, legs: [], completed: false };
  let failure;
  try {
    assert.deepEqual(readFileSync(join(repo, 'package-lock.json')), execFileSync('git', ['show', SOURCES.B + ':package-lock.json'], { cwd: repo }), 'launch tooling lock differs from selected source');
    const harness = join(repo, HARNESS);
    const harnessPlaywright = realpathSync(createRequire(harness).resolve('@playwright/test'));
    const preloadPlaywright = realpathSync(createRequire(join(here, 'observe-launch.mjs')).resolve('@playwright/test'));
    assert.equal(harnessPlaywright, preloadPlaywright, 'harness and launch observer resolve different Playwright instances');
    const tooling = playwrightIdentity(repo);
    assert.equal(fileHash(harness), HARNESS_SHA256, 'measured harness changed');
    const canonical = execFileSync('git', ['show', SOURCES.B + ':' + HARNESS], { cwd: repo });
    assert.deepEqual(readFileSync(harness), canonical, 'harness differs from selected source');
    copyFileSync(harness, join(output, 'island-original.mjs'));
    json(join(output, 'driver-inputs.json'), { head: capture('git', ['rev-parse', 'HEAD']), harnessSha256: HARNESS_SHA256,
      files: inventory(here), workflowSha256: fileHash(join(repo, '.github/workflows/adoption-comparison.yml')), harnessPlaywright, preloadPlaywright, tooling, resourceHelper: fileHash(join(repo, 'benchmarks/grand-prix/harness/resource-profile.mjs')),
      campaignHelper: fileHash(join(repo, 'benchmarks/grand-prix/harness/campaign.mjs')), lockSha256: fileHash(join(repo, 'package-lock.json')) });
    json(join(output, 'machine.json'), { platform: process.platform, arch: process.arch, node: process.version,
      nodeSha256: fileHash(process.execPath), npm: capture('npm', ['--version']), kernel: os.release(),
      cpus: os.cpus().map(cpu => ({ model: cpu.model, speed: cpu.speed })), totalMemory: os.totalmem(),
      availableMemoryBeforeBuild: os.freemem(), lscpu: capture('lscpu', ['--json']), systemd: capture('systemd-run', ['--version']),
      osRelease: readFileSync('/etc/os-release', 'utf8') });
    const pwRoot = dirname(require.resolve('playwright-core/package.json'));
    const pw = JSON.parse(readFileSync(join(pwRoot, 'package.json'))), registryFile = join(pwRoot, 'browsers.json');
    const registryData = JSON.parse(readFileSync(registryFile));
    const shell = registryData.browsers.find(x => x.name === 'chromium-headless-shell');
    assert.equal(pw.version, '1.64.1'); assert.equal(shell.revision, '1248'); assert.equal(shell.browserVersion, '156.0.8078.4');
    const { registry } = require(join(pwRoot, 'lib/coreBundle.js')).registry;
    const executable = realpathSync(registry.findExecutable('chromium-headless-shell').executablePath());
    assert(executable.startsWith(realpathSync(process.env.PLAYWRIGHT_BROWSERS_PATH) + '/'), 'browser outside owned download');
    const browser = { playwrightVersion: pw.version, registry: registryData, registrySha256: fileHash(registryFile),
      executable, executableSha256: fileHash(executable), version: shell.browserVersion };
    json(join(output, 'browser.json'), browser); copyFileSync(registryFile, join(output, 'browsers-original.json'));
    for (const source of ['A', 'B']) {
      const dest = join(output, source), checkout = join(work, source); mkdirSync(dest); mkdirSync(checkout);
      assert.equal(capture('git', ['rev-parse', SOURCES[source] + '^{commit}']), SOURCES[source]);
      const archive = join(dest, 'source.tar');
      capture('git', ['archive', '--format=tar', '--output=' + archive, SOURCES[source]]);
      capture('tar', ['-xf', archive, '-C', checkout]);
      assert.equal(readFileSync(join(checkout, '.node-version'), 'utf8').trim(), '24.22.0');
      const lock = fileHash(join(checkout, 'package-lock.json'));
      copyFileSync(join(checkout, 'package-lock.json'), join(dest, 'package-lock.json'));
      copyFileSync(join(checkout, 'packages/core/package.json'), join(dest, 'core-package.json'));
      const env = { ...process.env, NODE_OPTIONS: '', NODE_ENV: '', CI: 'true' };
      await command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], checkout, join(dest, 'install'), env);
      const installedPlaywright = playwrightIdentity(checkout);
      assert.deepEqual(installedPlaywright, tooling, 'source build Playwright identity differs from common launch tooling');
      await command('npm', ['run', 'build', '-w', 'packages/core'], checkout, join(dest, 'build'), env);
      assert.equal(fileHash(join(checkout, 'package-lock.json')), lock, 'build changed committed lock');
      copyFileSync(join(checkout, 'node_modules/.package-lock.json'), join(dest, 'installed-lock.json'));
      await command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dest], join(checkout, 'packages/core'), join(dest, 'pack'), env);
      const packs = JSON.parse(readFileSync(join(dest, 'pack.stdout'), 'utf8')); assert.equal(packs.length, 1);
      assert(/^[A-Za-z0-9._-]+\.tgz$/.test(packs[0].filename));
      const entry = join(checkout, 'packages/core/dist/forma.esm.js');
      copyFileSync(entry, join(dest, 'forma.esm.js'));
      run.builds[source] = { commit: SOURCES[source], installedPlaywright, sourceArchiveSha256: fileHash(archive), lockSha256: lock,
        packageSha256: fileHash(join(dest, packs[0].filename)), packageFiles: inventory(join(checkout, 'packages/core/dist')),
        entry, entrySha256: fileHash(entry) };
      json(join(dest, 'build-provenance.json'), run.builds[source]);
    }
    for (let index = 0; index < SEQUENCE.length; index++) {
      const source = SEQUENCE[index], unit = state.units[index], dest = join(output, `leg-${index}-${source}`); mkdirSync(dest);
      const expected = { ...browser, affinity: resources.measured, unit };
      const expectedFile = join(dest, 'expected-launch.json'), recordFile = join(dest, 'launch.json'); json(expectedFile, expected);
      const entry = run.builds[source].entry;
      assert.equal(fileHash(entry), run.builds[source].entrySha256); assert.equal(fileHash(harness), HARNESS_SHA256);
      const args = ['-n', 'systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--service-type=exec', '--unit=' + unit,
        '--description=' + ownedUnit(unit, campaign.id), '--uid=' + process.getuid(), '--gid=' + process.getgid(),
        '--working-directory=' + repo, '--property=MemoryMax=' + MEMORY_BYTES, '--property=MemorySwapMax=0',
        '--property=AllowedCPUs=' + resources.measured.join(','), '--property=RuntimeMaxSec=180', '--property=TimeoutStopSec=10',
        '/usr/bin/env', 'PATH=' + process.env.PATH, 'HOME=' + process.env.HOME, 'NODE_OPTIONS=',
        'PLAYWRIGHT_BROWSERS_PATH=' + process.env.PLAYWRIGHT_BROWSERS_PATH,
        'ADOPTION_LAUNCH_EXPECTED=' + expectedFile, 'ADOPTION_LAUNCH_RECORD=' + recordFile,
        process.execPath, '--import', join(here, 'observe-launch.mjs'), harness,
        '--rows', '1000', '--warm', '5', '--runs', '15', '--entry', entry];
      const leg = { index, source, sourceCommit: SOURCES[source], entrySha256: fileHash(entry), startedAt: new Date().toISOString() };
      run.legs.push(leg);
      try {
        await command('sudo', args, repo, join(dest, 'harness'), process.env, 210000);
        const result = JSON.parse(readFileSync(join(dest, 'harness.stdout'), 'utf8'));
        leg.statistics = validateResult(result, { entry, browserVersion: browser.version });
        validateLaunch(JSON.parse(readFileSync(recordFile)), expected);
        assert.equal(JSON.parse(readFileSync(recordFile + '.closed.json')).originalProcessRemains, false);
        assert.equal(fileHash(entry), leg.entrySha256, 'measured artifact changed');
        leg.result = result; leg.completed = true;
      } catch (error) { leg.error = error.message; throw error; }
      finally {
        leg.finishedAt = new Date().toISOString();
        try { leg.cleanup = cleanupUnit(unit, campaign.id); }
        catch (error) { leg.cleanupError = error.message; }
        json(join(dest, 'result.json'), leg);
        // A leg error already propagating stays the reported failure; cleanup errors are retained beside it.
        if (leg.cleanupError && !leg.error) throw new Error('leg cleanup failed: ' + leg.cleanupError);
      }
    }
    run.summary = summarize(run.legs); run.completed = true;
  } catch (error) { run.error = error.message; failure = error; }
  finally {
    try { run.cleanup = cleanupOwned(state); if (run.cleanup.errors.length) throw new Error('scoped cleanup failed'); }
    catch (error) { run.completed = false; run.cleanupError = error.message; failure ??= error; }
    json(join(output, 'run.json'), run);
    json(join(output, 'SHA256SUMS.json'), inventory(output));
  }
  if (failure) throw failure;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--cleanup') {
    const output = resolve(process.argv[3]), state = JSON.parse(readFileSync(join(output, 'ownership.json')));
    const result = cleanupOwned(state); json(join(output, 'workflow-cleanup.json'), result);
    writeFileSync(join(output, 'SHA256SUMS.json'), JSON.stringify(inventory(output).filter(x => x.path !== 'SHA256SUMS.json'), null, 2) + '\n');
    assert.equal(result.errors.length, 0);
  } else {
    assert.equal(process.argv[2], '--output'); await main(resolve(process.argv[3]));
  }
}
