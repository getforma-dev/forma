// FORMA-129: actual candidate runtime and committed private-source campaign.
// DS12 embeds this P17 result; a checked-in older report is never release proof.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, digest, json, run } from './release-set.mjs';
import { cases, profiles } from '../packages/core/e2e/hostile-widgets/catalogue.mjs';
import { capabilityCases } from '../packages/core/e2e/hostile-widgets/capabilities.mjs';

const browserRoot = join(ROOT, 'packages/core/e2e/hostile-widgets');
const expressionRoot = join(ROOT, 'packages/core/scripts');
const harnessFiles = ['catalogue.mjs', 'browser-case.mjs', 'capabilities.mjs', 'observers.mjs', 'server.mjs', 'run.mjs', 'probe-provenance.json'];
const ordered = values => values.slice().sort();
const hash = value => assert.match(value ?? '', /^[a-f0-9]{64}$/, 'missing security proof hash');
export const securityHarnessHashes = () => Object.fromEntries(harnessFiles.map(name => [name, digest(join(browserRoot, name))]));

export function validateHostileProof(report, { commit, runtimeSha256, harnessSources }) {
  assert.equal(report.schema, 1);
  assert.equal(report.passed, true, 'hostile matrix did not pass');
  assert.equal(report.completeMatrix, true, 'a partial matrix is not release proof');
  assert.equal(report.selection, null);
  assert.equal(report.sourceCommit, commit, 'hostile source differs from packed set');
  assert.equal(report.sourceClean, true, 'hostile source was modified');
  assert.equal(report.runtimeSha256, runtimeSha256, 'hostile runtime differs from candidate bytes');
  assert.deepEqual(report.harnessSources, harnessSources, 'hostile harness differs from current source');
  assert.deepEqual(report.pageErrors, []);
  const expected = cases().map(item => item.id);
  const expectedCapabilities = capabilityCases.flatMap(item => profiles.map(profile => `${item.id}/${profile}`));
  assert.equal(report.requested, expected.length);
  assert.equal(report.requestedCapabilityControls, expectedCapabilities.length);
  assert.deepEqual(ordered(report.cases.map(item => item.id)), ordered(expected), 'hostile cases missing or duplicated');
  assert.deepEqual(ordered(report.capabilities.map(item => item.id)), ordered(expectedCapabilities), 'capability controls missing or duplicated');
  for (const item of report.cases) {
    assert.equal(item.live, true);
    assert.equal(item.executed, 0);
    assert.equal(item.outsideReads, 0);
    assert.equal(item.unauthorizedRequests, 0);
  }
  assert.deepEqual(report.observers.map(item => item.profile), profiles);
  for (const observer of report.observers) {
    assert.equal(observer.executions, 1); assert.equal(observer.outsideReads, 1);
    assert.equal(observer.response, 200); assert.equal(observer.unexpectedResponse, 404);
    assert.equal(observer.trustedTypesRefused, true);
  }
  hash(report.catalogueSha256); hash(runtimeSha256);
  return report;
}

export function validateExpressionProof(summary, proofs, commit) {
  assert.equal(summary.passed, true, 'expression mutation qualification did not pass');
  assert.equal(summary.seed, 1290300); assert.equal(summary.cases, 100_000);
  assert.deepEqual(summary.runs.map(item => item.mode), ['before', 'mutant', 'corrected']);
  for (const [index, mode] of ['before', 'mutant', 'corrected'].entries()) {
    const { report, sha256 } = proofs[mode];
    assert.equal(summary.runs[index].sha256, sha256, 'expression proof bytes differ from recorded hash');
    assert.equal(report.sourceCommit, commit, 'expression source differs from packed set');
    assert.equal(report.sourceClean, true, 'expression source was modified');
    assert.equal(report.seed, 1290300); assert.equal(report.cases, 100_000);
    hash(report.sourceSha256); hash(report.workerSha256); hash(report.engineSha256);
    if (mode === 'mutant') {
      assert.equal(summary.runs[index].status, 1); assert.equal(report.passed, false);
      assert.equal(report.status, 'failed'); assert.equal(report.mutation?.name, 'remove-array-from');
      assert.equal(report.failure?.input.operation, 'Array.from');
      assert(report.failure.index < 100_000);
      assert(report.failure.input.minimumCost > 0);
      assert(report.failure.input.state.shape.length > 0 && report.failure.input.state.shape.length <= 64);
      assert.match(report.error, /cost undercharge for Array\.from: actual 0, independent floor/);
    } else {
      assert.equal(summary.runs[index].status, 0); assert.equal(report.passed, true); assert.equal(report.status, 'complete');
      assert.equal(report.report.requested, 100_000); assert.equal(report.report.completed, 100_000);
      for (const count of [report.report.admitted, report.report.refused]) assert(Number.isSafeInteger(count) && count > 0, 'expression count must be a positive integer');
      assert.equal(report.report.admitted + report.report.refused, 100_000);
      assert.deepEqual(report.preflight, { admittedNativeCalls: 1, refusedNativeCalls: 0, code: 'FORMA_E_BUDGET' });
      assert.equal(report.residuals.length, 12); assert.equal(report.regressions.length, 3);
    }
  }
  const before = proofs.before.report, mutant = proofs.mutant.report, after = proofs.corrected.report;
  assert.equal(before.sourceSha256, mutant.sourceSha256); assert.equal(before.sourceSha256, after.sourceSha256);
  assert.equal(before.workerSha256, after.workerSha256); assert.notEqual(before.workerSha256, mutant.workerSha256);
  return summary;
}

export async function verifyPackedSecurity({ set, scratch, test, evidenceDir, result = {} }) {
  assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), set.commit, 'P17 security harness must run the packed commit');
  const entries = set.packages.filter(item => item.registry === 'npm' && item.name === '@getforma/core');
  assert.equal(entries.length, 1);
  const core = entries[0];
  assert.equal(core.path, 'packages/core', 'unexpected packed core source location');
  const coreDir = resolve(scratch, core.path);
  assert.equal(json(join(coreDir, 'package.json')).version, core.version);
  const runtime = join(coreDir, 'dist/formajs-runtime.global.js'), runtimeSha256 = digest(runtime);
  // The caller places evidence beside p17.json, outside its disposable scratch.
  // A failed child must leave its original partial report for diagnosis.
  const directory = resolve(evidenceDir); mkdirSync(directory, { recursive: true });
  const report = Object.assign(result, { schema: 1, passed: false, commit: set.commit, evidenceDirectory: directory, package: { name: core.name, version: core.version, archiveSha256: core.sha256 }, runtimeSha256 });
  await test('packed core: complete hostile widget matrix and actual removed-selector-guard control', async () => {
    const path = join(directory, 'hostile-widgets.json');
    run(process.execPath, [join(browserRoot, 'run.mjs'), `--runtime=${runtime}`, `--out=${path}`], ROOT, { timeout: 180_000 });
    report.hostile = validateHostileProof(json(path), { commit: set.commit, runtimeSha256, harnessSources: securityHarnessHashes() });
    report.hostileSha256 = digest(path);
    run(process.execPath, [join(browserRoot, 'qualify-guard.mjs'), `--runtime=${runtime}`, `--out-dir=${directory}`], ROOT, { timeout: 120_000 });
    const guard = json(join(directory, 'guard-qualification.json'));
    assert.equal(guard.passed, true); assert.equal(guard.originalSha256, runtimeSha256);
    assert.deepEqual(guard.runs.map(item => [item.mode, item.exit]), [['before', 0], ['mutant', 1], ['corrected', 0]]);
    for (const item of guard.runs) assert.equal(digest(join(directory, `guard-${item.mode}.json`)), item.sha256);
    const mutant = json(join(directory, 'guard-mutant.json'));
    assert.match(mutant.error, /unauthorized outside-root read/);
    assert.equal(mutant.current.profile, 'none'); assert(mutant.lastObservation.outsideReads > 0);
    assert.equal(digest(runtime), runtimeSha256, 'candidate runtime changed during mutation qualification');
    report.guard = guard;
  });
  await test('committed expression source: 100000 cases, real removed-cost control and corrected replay', async () => {
    run(process.execPath, [join(expressionRoot, 'qualify-expression-mutation.mjs'), `--out-dir=${directory}`], ROOT, { timeout: 450_000 });
    const summary = json(join(directory, 'mutation-qualification.json'));
    const proofs = Object.fromEntries(['before', 'mutant', 'corrected'].map(mode => {
      const path = join(directory, `mutation-${mode}.json`);
      return [mode, { report: json(path), sha256: digest(path) }];
    }));
    validateExpressionProof(summary, proofs, set.commit);
    report.expressions = { basis: 'committed private expression source at the packed-set commit; actual numerical mutation', summary, proofs };
  });
  report.harnessDrivers = Object.fromEntries([
    ['release-security.mjs', join(ROOT, 'scripts/release-security.mjs')],
    ['qualify-guard.mjs', join(browserRoot, 'qualify-guard.mjs')],
    ['qualify-expression-mutation.mjs', join(expressionRoot, 'qualify-expression-mutation.mjs')],
  ].map(([name, path]) => [name, digest(path)]));
  report.passed = true;
  return report;
}
