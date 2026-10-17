#!/usr/bin/env node
// Pre-RC setup rehearsal only. This entry point cannot create burn-in evidence.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, digest, json, run } from './release-set.mjs';
import { validateCandidate } from './candidate-scaffold.mjs';
import { prepareBurnIn } from './release-burn-in-stage.mjs';
import { FUZZ_TARGETS } from './release-burn-in-report.mjs';
import { loggedChild, saveExclusive } from './release-burn-in.mjs';

export function setupInputs({ directory, recordSha256, commit, root = ROOT }) {
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit, 'setup source differs');
  assert.equal(run('git', ['diff', '--name-only', 'HEAD'], root).trim(), '', 'setup source is uncommitted');
  const set = validateCandidate(directory, recordSha256, commit);
  assert.equal(set.dryRun, true, 'setup rehearsal requires dry-pack inputs');
  return { set, archives: directory, packages: set.packages.map(item => ({ ...item, bytes: statSync(join(directory, item.file)).size })) };
}
export function seedReplay(log) {
  const matches = [...log.matchAll(/^Done ([0-9]+) runs in ([0-9]+) second\(s\)$/gm)];
  assert.equal(matches.length, 1, 'missing/ambiguous completed seed replay');
  const inputs = Number(matches[0][1]), seconds = Number(matches[0][2]);
  assert.equal(inputs, 1000, 'seed replay did not finish its 1000 inputs');
  assert(Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 30);
  return { inputs, seconds, activeNanoseconds: '0' };
}
export async function rehearseSetup({ directory, recordSha256, commit, work, evidence }) {
  assert.equal(process.platform, 'linux');
  mkdirSync(evidence);
  const report = { contract: 'rc-burn-in-setup-v1', rehearsal: true, rcAuthenticated: false,
    activeNanoseconds: '0', burnInPassed: false, releaseAccepted: false, complete: false,
    sourceCommit: commit, recordSha256, work, steps: [], seeds: [], faults: [] };
  try {
    const authenticated = setupInputs({ directory, recordSha256, commit });
    report.packages = authenticated.packages;
    const staged = await prepareBurnIn({ authenticated, work, test: async (name, fn) => {
      await fn(); report.steps.push(name);
    } });
    report.prepared = { templateSources: staged.templateSources, cliLock: staged.cliLock,
      fuzzLock: staged.fuzzLock, metadata: staged.metadata, sourceReport: staged.sourceReport,
      tools: { node: process.version, nightly: run('rustc', ['-Vv'], staged.fuzz,
        { env: { ...process.env, RUSTUP_TOOLCHAIN: 'nightly-2026-10-01' } }),
        cargoFuzz: run('cargo', ['fuzz', '--version'], staged.fuzz) },
      binaries: Object.fromEntries(Object.entries(staged.binaries).map(([name, file]) => [name, { bytes: statSync(file).size, sha256: digest(file) }])) };
    saveExclusive(join(evidence, 'prepared.json'), report.prepared);
    for (const [index, target] of FUZZ_TARGETS.entries()) {
      const log = join(evidence, `${target}.log`), findings = join(evidence, `${target}-findings`);
      mkdirSync(findings);
      await loggedChild(staged.binaries[target], [join(staged.fuzz, 'corpus', target), '-runs=1000', '-max_total_time=30', '-timeout=10', '-rss_limit_mb=2048', '-max_len=65536', `-seed=${100 + index}`, `-artifact_prefix=${findings}/`], {
        cwd: staged.fuzz, log, timeout: 45_000, env: { ...process.env, ASAN_OPTIONS: 'abort_on_error=1:detect_leaks=1' },
      });
      assert.deepEqual(readdirSync(findings), [], 'ASan seed replay produced a finding'); rmSync(findings);
      const result = seedReplay(readFileSync(log, 'utf8'));
      report.seeds.push({ target, ...result, logSha256: digest(log), binarySha256: digest(staged.binaries[target]) });
    }
    assert.deepEqual(setupInputs({ directory, recordSha256, commit }).packages, report.packages, 'original dry-pack inputs changed');
    report.setupPassed = true;
  } catch (error) { report.faults.push({ message: error.message, stack: error.stack }); throw error; }
  finally { saveExclusive(join(evidence, 'setup.json'), report); }
}
export function finishSetup({ evidence, ownership, work }) {
  const proof = json(join(ownership, 'supervisor.json')), report = json(join(evidence, 'setup.json'));
  assert.equal(proof.complete, true); assert.equal(proof.exitCode, 0); assert.deepEqual(proof.faults, []);
  assert.equal(proof.cleanup.complete, true); assert.deepEqual(proof.cleanup.remainingOwnedPids, []); assert.deepEqual(proof.cleanup.failures, []);
  assert.equal(report.contract, 'rc-burn-in-setup-v1'); assert.equal(report.rehearsal, true); assert.equal(report.rcAuthenticated, false);
  assert.equal(report.burnInPassed, false); assert.equal(report.releaseAccepted, false); assert.equal(report.activeNanoseconds, '0');
  assert.equal(report.setupPassed, true); assert.deepEqual(report.faults, []); assert.equal(report.work, work);
  assert.deepEqual(report.seeds.map(row => row.target), FUZZ_TARGETS);
  for (const row of report.seeds) {
    const log = join(evidence, `${row.target}.log`); assert.equal(digest(log), row.logSha256);
    const raw = seedReplay(readFileSync(log, 'utf8'));
    for (const [key, value] of Object.entries(raw)) assert.equal(row[key], value);
  }
  rmSync(work, { recursive: true }); assert(!existsSync(work));
  saveExclusive(join(evidence, 'complete.json'), { ...report, complete: true, cleanup: proof.cleanup });
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'worker') {
    assert.equal(args.length, 5); const [directory, recordSha256, commit, work, evidence] = args;
    await rehearseSetup({ directory: resolve(directory), recordSha256, commit, work: resolve(work), evidence: resolve(evidence) });
  } else if (mode === 'finalize') {
    assert.equal(args.length, 3); const [evidence, ownership, work] = args;
    finishSetup({ evidence: resolve(evidence), ownership: resolve(ownership), work: resolve(work) });
  } else throw Error('usage: release-burn-in-setup.mjs worker DIR DS11_SHA COMMIT WORK EVIDENCE | finalize EVIDENCE OWNERSHIP WORK');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
