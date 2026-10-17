#!/usr/bin/env node
// A sequential, no-retry workload driver. The Linux subreaper owns its children.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, digest, json, run } from './release-set.mjs';
import { authenticateRc } from './release-burn-in-inputs.mjs';
import { prepareBurnIn } from './release-burn-in-stage.mjs';
import { CONTRACT, ENGINES, FUZZ_TARGETS, MIN_ACTIVE_NS, readFuzzCompletion } from './release-burn-in-report.mjs';
import { securityHarnessHashes, validateHostileProof } from './release-security.mjs';
import { hostileIds, fixtureCheckIds } from './release-burn-in-identities.mjs';
import { readApps } from '../e2e/fixtures/apps/lib/build-apps.mjs';
import { verifyStagedFixturePages } from './release-fixture-apps.mjs';
import { requireSkewChecks } from './release-skew-drill.mjs';
import { runSkewDrill } from '../e2e/skew/run-drill.mjs';
import { verifyMinimalIsland, verifyStaticTemplate, verifyDashboardTemplate } from './release-template-islands.mjs';
import { withOwnedServer } from './owned-server.mjs';
import { recordEvidence } from './release-evidence.mjs';
import { evidenceBytes, evidenceRoom } from './release-burn-in-storage.mjs';
export { evidenceBytes } from './release-burn-in-storage.mjs';

const MiB = 1024 * 1024;
const now = () => process.hrtime.bigint();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function saveExclusive(path, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert(bytes.length <= 16 * MiB, 'logical report exceeds limit');
  const fd = openSync(path, 'wx'); try { let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset); fsyncSync(fd); } finally { closeSync(fd); }
  return sha(bytes);
}
export async function loggedChild(command, args, { cwd, log, timeout, env = process.env }) {
  const fd = openSync(log, 'wx'); let size = 0, failure;
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = error => { failure ??= error; child.kill('SIGTERM'); };
  const capture = data => { try { size += data.length; assert(size <= 16 * MiB, 'child log cap exceeded'); let offset = 0; while (offset < data.length) offset += writeSync(fd, data, offset); } catch (error) { stop(error); } };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const timer = setTimeout(() => stop(Error('workload deadline exceeded')), timeout);
  // Force the whole worker to fail if a child ignores termination. Its Linux
  // supervisor then sweeps detached descendants; no next task can start.
  const hard = setTimeout(() => process.exit(1), timeout + 15_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    fsyncSync(fd); if (failure) throw failure; assert.equal(code, 0, 'workload process failed'); return code;
  } finally { clearTimeout(timer); clearTimeout(hard); closeSync(fd); }
}
function observedHostileIds(report) { return [ ...report.cases.map(r => `case:${r.id}`), ...report.capabilities.map(r => `capability:${r.id}`), ...report.explicitMount.map(r => `explicit:${r.id}`), ...report.observers.map(r => `observer:${r.profile}`) ]; }
function fileInventory(paths) {
  const result = {};
  const walk = path => { const stat = lstatSync(path); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) for (const child of readdirSync(path).sort()) walk(join(path, child)); else { assert(stat.isFile()); result[path] = { bytes: stat.size, sha256: digest(path) }; } };
  for (const path of paths) walk(path); return result;
}
async function task(round, id, directory, fn) {
  const startedNs = now(), file = join(directory, `${id.replaceAll(':', '-')}.json`);
  const timeout = setTimeout(() => { saveExclusive(join(directory, 'deadline.json'), { task: id, startedNs: String(startedNs) }); process.exit(1); }, 300_000);
  try {
    const { proof, fields = {} } = await fn(startedNs);
    // Every raw producer result is durably retained before summary acceptance.
    const reportSha256 = saveExclusive(file, proof), finishedNs = now();
    const row = { id, startedNs: String(startedNs), finishedNs: String(finishedNs), complete: true, exitCode: 0, faults: [], activeNanoseconds: '0', reportSha256, ...fields };
    round.tasks.push(row); return row;
  } finally { clearTimeout(timeout); }
}
export async function worker({ tag, commit, attempt, work }) {
  assert.equal(process.platform, 'linux'); assert(!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'burn-in must not carry publishing authority');
  assert.equal(process.env.GITHUB_REPOSITORY, 'getforma-dev/forma'); assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REF, `refs/tags/${tag}`); assert.equal(process.env.GITHUB_SHA, commit);
  mkdirSync(attempt); const inputs = join(attempt, 'inputs'), preparedProof = [];
  const report = { contract: CONTRACT, rcTag: tag, sourceCommit: commit, harnessCommit: commit, complete: false, zeroFaults: false, faults: [], rounds: [], cleanup: { complete: false, remainingOwnedPids: [], failures: ['awaiting Linux supervisor'] } };
  try {
    const auth = await authenticateRc({ tag, commit, directory: inputs });
    const staged = await prepareBurnIn({ authenticated: auth, work, test: async (name, fn) => { await fn(); preparedProof.push(name); } });
    const { chromium, firefox, webkit } = await import('@playwright/test');
    const launchers = { chromium, firefox, webkit };
    const runtime = join(staged.extracted['@getforma/core'], 'dist/formajs-runtime.global.js'), runtimeSha256 = digest(runtime);
    const harnessSha256 = sha(run('git', ['ls-tree', '-r', '-z', commit], ROOT, { encoding: 'buffer' }));
    const expected = { rcTag: tag, sourceCommit: commit, packages: auth.packages, ds12Sha256: auth.ds12Sha256, p17EvidenceSha256: auth.p17EvidenceSha256, d14EvidenceSha256: auth.d14EvidenceSha256, harnessSha256, runtimeSha256, hostileCaseIds: hostileIds(), fixtureCheckIds: fixtureCheckIds(staged.fixtures.project) };
    const protectedPaths = [ ...Object.values(staged.binaries), ...Object.values(staged.templates).flatMap(p => [p.binary, join(p.project, 'admin/dist')]), staged.skew.binary, ...['A', 'B', 'B2', 'C', 'S'].map(name => staged.skew.deployments[name].dist), join(staged.fixtures.project, 'out'), ...Object.keys(readApps(staged.fixtures.project).apps).map(name => join(staged.fixtures.targetDir, 'release', `fixture-${name}`)), ...Object.values(launchers).map(engine => engine.executablePath()), runtime, join(ROOT, 'package-lock.json') ];
    const before = fileInventory(protectedPaths);
    saveExclusive(join(attempt, 'expected.json'), expected); saveExclusive(join(attempt, 'prepared.json'), { preparedProof, before, tools: { node: process.version, rust: run('rustc', ['-Vv']), fuzz: run('cargo', ['fuzz', '--version'], staged.fuzz), playwright: json(join(ROOT, 'node_modules/@playwright/test/package.json')).version }, staged: { descriptor: staged.descriptor, templateSources: staged.templateSources, cliSignatures: staged.cliSignatures, cliLock: staged.cliLock, fuzzLock: staged.fuzzLock, sourceReport: staged.sourceReport } });
    evidenceBytes(attempt);
    Object.assign(report, expected); delete report.hostileCaseIds; delete report.fixtureCheckIds;
    let active = 0n;
    for (let index = 1; active < MIN_ACTIVE_NS; index++) {
      assert(index <= 256, 'round count bound');
      // Reserve the complete bounded round and final records before starting it.
      // 9 task reports + 4 fuzz logs + hostile log/raw + 3 raw skew reports
      // + round record fit below 384 MiB; 64 MiB remain for final records.
      evidenceRoom(attempt, 448 * MiB);
      const directory = join(attempt, `round-${String(index).padStart(3, '0')}`); mkdirSync(directory);
      const round = { index, complete: false, tasks: [] }; report.rounds.push(round);
      for (const [targetIndex, target] of FUZZ_TARGETS.entries()) {
        const seed = index * 4 + targetIndex, log = join(directory, `${target}.log`), findings = join(directory, `findings-${target}`); mkdirSync(findings);
        await task(round, `fuzz:${target}`, directory, async start => {
          await loggedChild(staged.binaries[target], [join(staged.fuzz, 'corpus', target), '-max_total_time=60', '-timeout=10', '-rss_limit_mb=2048', '-max_len=65536', `-seed=${seed}`, '-print_final_stats=1', `-artifact_prefix=${findings}/`], { cwd: staged.fuzz, log, timeout: 120_000, env: { ...process.env, ASAN_OPTIONS: 'abort_on_error=1:detect_leaks=1' } });
          assert.deepEqual(readdirSync(findings), [], 'fuzzer produced a finding'); rmdirSync(findings); // Empty directories are not evidence.
          const completed = readFuzzCompletion(readFileSync(log, 'utf8'), String(now() - start)); active += BigInt(completed.activeNanoseconds);
          return { proof: { target, seed, ...completed, logSha256: digest(log), binarySha256: before[staged.binaries[target]].sha256 }, fields: { seed, ...completed } };
        });
      }
      await task(round, 'hostile', directory, async () => {
        const out = join(directory, 'hostile-raw.json');
        await loggedChild(process.execPath, [join(ROOT, 'packages/core/e2e/hostile-widgets/run.mjs'), `--runtime=${runtime}`, `--out=${out}`], { cwd: ROOT, log: join(directory, 'hostile.log'), timeout: 180_000 });
        const proof = validateHostileProof(json(out), { commit, runtimeSha256, harnessSources: securityHarnessHashes() });
        return { proof, fields: { completeMatrix: true, caseIds: observedHostileIds(proof) } };
      });
      for (const engine of ENGINES) await task(round, `skew:${engine}`, directory, async () => {
        const browser = await launchers[engine].launch();
        try { const proof = await runSkewDrill({ browser, binary: staged.skew.binary, cwd: staged.skew.server, deployments: staged.skew.deployments }); saveExclusive(join(directory, `skew-${engine}-raw.json`), proof); requireSkewChecks(proof); return { proof, fields: { checks: proof.checks } }; }
        finally { await browser.close(); }
      });
      await task(round, 'fixtures', directory, async () => {
        const browser = await chromium.launch();
        try {
          const pages = await verifyStagedFixturePages({ staged: staged.fixtures, browser, test: async (_name, fn) => fn() }), templates = {};
          for (const [name, entry] of Object.entries(staged.templates)) await withOwnedServer(entry.binary, [], entry.project, async (_response, origin) => {
            templates[name] = name === 'minimal' ? { island: await verifyMinimalIsland(browser, origin, entry.manifest), static: await verifyStaticTemplate(browser, origin, entry.manifest) } : await verifyDashboardTemplate(browser, origin);
          }, { timeout: 60_000 });
          const checkIds = [...pages.pages.map(p => `fixture:${p.app}:${p.page}`), ...pages.extras.map(name => `extra:${name}`), 'template:minimal:adoption', 'template:minimal:static', 'template:dashboard:interaction'];
          assert.deepEqual(checkIds.slice().sort(), expected.fixtureCheckIds.slice().sort());
          return { proof: { pages, templates }, fields: { checkIds } };
        } finally { await browser.close(); }
      });
      round.startedNs = round.tasks[0].startedNs; round.finishedNs = round.tasks.at(-1).finishedNs; round.complete = true;
      saveExclusive(join(directory, 'round.json'), round); evidenceBytes(attempt);
    }
    assert.deepEqual(fileInventory(protectedPaths), before, 'prepared product/browser/source bytes changed');
    for (const p of auth.packages) assert.equal(digest(join(auth.archives, p.file)), p.sha256);
    assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), commit); assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no']).trim(), '');
    report.startedNs = report.rounds[0].startedNs; report.finishedNs = report.rounds.at(-1).finishedNs;
    report.activeNanoseconds = String(active); report.orchestrationNanoseconds = String(BigInt(report.finishedNs) - BigInt(report.startedNs) - active);
    report.workloadsComplete = true;
  } catch (error) { report.faults.push({ message: error.message, stack: error.stack }); throw error; }
  finally { saveExclusive(join(attempt, 'workloads.json'), report); }
}
export async function finalize({ attempt, ownership, work }) {
  const supervisor = json(join(ownership, 'supervisor.json')), report = json(join(attempt, 'workloads.json')), expected = json(join(attempt, 'expected.json'));
  assert.equal(supervisor.complete, true, 'Linux ownership or worker failed'); assert.equal(supervisor.exitCode, 0);
  assert.equal(supervisor.cleanup.complete, true); assert.deepEqual(supervisor.cleanup.remainingOwnedPids, []); assert.deepEqual(supervisor.cleanup.failures, []); assert.deepEqual(supervisor.faults, []);
  assert.equal(report.workloadsComplete, true); assert.deepEqual(report.faults, []);
  report.cleanup = { complete: true, remainingOwnedPids: [], failures: [] }; report.complete = true; report.zeroFaults = true;
  const { validateBurnInFiles } = await import('./release-burn-in-final.mjs');
  validateBurnInFiles(attempt, expected, report); evidenceRoom(attempt, 64 * MiB);
  rmSync(work, { recursive: true }); assert(!existsSync(work));
  saveExclusive(join(attempt, 'ownership.json'), supervisor); saveExclusive(join(attempt, 'burn-in.json'), report);
  const manifestSha256 = await recordEvidence(attempt); console.log(manifestSha256);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `manifest-sha256=${manifestSha256}\n`, { flag: 'a' });
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'worker') { const [tag, commit, attempt, work] = args; assert.equal(args.length, 4); await worker({ tag, commit, attempt: resolve(attempt), work: resolve(work) }); }
  else if (mode === 'finalize') { const [attempt, ownership, work] = args; assert.equal(args.length, 3); await finalize({ attempt: resolve(attempt), ownership: resolve(ownership), work: resolve(work) }); }
  else throw Error('usage: release-burn-in.mjs worker TAG COMMIT ATTEMPT WORK | finalize ATTEMPT OWNERSHIP WORK');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
