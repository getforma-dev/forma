import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHostileProof, validateExpressionProof, securityHarnessHashes } from './release-security.mjs';
import { cases, profiles } from '../packages/core/e2e/hostile-widgets/catalogue.mjs';
import { capabilityCases } from '../packages/core/e2e/hostile-widgets/capabilities.mjs';
const commit = 'a'.repeat(40), sha = 'b'.repeat(64);
const expected = { commit, runtimeSha256: sha, harnessSources: securityHarnessHashes() };
function hostile() {
  return { schema: 1, passed: true, completeMatrix: true, selection: null, sourceCommit: commit, sourceClean: true,
    runtimeSha256: sha, catalogueSha256: sha, harnessSources: structuredClone(expected.harnessSources), pageErrors: [], requested: cases().length,
    requestedCapabilityControls: capabilityCases.length * profiles.length,
    cases: cases().map(({ id }) => ({ id, live: true, executed: 0, outsideReads: 0, unauthorizedRequests: 0 })),
    capabilities: capabilityCases.flatMap(({ id }) => profiles.map(profile => ({ id: `${id}/${profile}` }))),
    explicitMount: profiles.flatMap(profile => [
      { id: `no-auto/${profile}`, served: 'raw', injected: 'raw', unauthorizedRequests: 0 },
      ...['compiled', 'reviewed'].map(tier => ({ id: `omitted-${tier}/${profile}`, live: true, reach: 'confined', failed: 'data-fetch denied: the mount grants no fetch', activations: 0, outsideReads: 0, unauthorizedRequests: 0, codes: ['FORMA_E_GRANT_FETCH', 'FORMA_E_GRANT_NAVIGATE'] })),
    ]),
    observers: profiles.map(profile => ({ profile, executions: 1, outsideReads: 1, response: 200, unexpectedResponse: 404, trustedTypesRefused: true })) };
}
test('P17 refuses partial, stale, duplicated, disconnected and unsafe hostile proof', () => {
  assert.equal(validateHostileProof(hostile(), expected).cases.length, 1950);
  for (const mutate of [
    r => r.completeMatrix = false, r => r.sourceCommit = 'c'.repeat(40), r => r.sourceClean = false,
    r => r.runtimeSha256 = 'c'.repeat(64), r => delete r.harnessSources['observers.mjs'],
    r => r.cases.pop(), r => r.cases[1] = r.cases[0], r => r.capabilities.pop(),
    r => r.cases[0].executed = 1, r => r.cases[0].outsideReads = 1,
    r => r.cases[0].unauthorizedRequests = 1, r => r.cases[0].live = false,
    r => r.observers[0].outsideReads = 0, r => r.observers[1].unexpectedResponse = 200,
    r => r.pageErrors.push('actual browser failure'),
    r => r.explicitMount.pop(), r => r.explicitMount[1] = r.explicitMount[0],
    r => r.explicitMount[0].served = '1', r => r.explicitMount[0].injected = '2',
    r => r.explicitMount[1].activations = 1, r => r.explicitMount[1].live = false,
    r => r.explicitMount[1].outsideReads = 1, r => r.explicitMount[1].unauthorizedRequests = 1,
    r => r.explicitMount[1].codes.push('FORMA_E_UNRESOLVED'),
  ]) { const r = hostile(); mutate(r); assert.throws(() => validateHostileProof(r, expected)); }
});
function expression() {
  const admitted = { sourceCommit: commit, sourceClean: true, seed: 1290300, cases: 100_000,
    sourceSha256: sha, workerSha256: sha, engineSha256: sha, passed: true, status: 'complete',
    report: { requested: 100_000, completed: 100_000, admitted: 87000, refused: 13000 },
    preflight: { admittedNativeCalls: 1, refusedNativeCalls: 0, code: 'FORMA_E_BUDGET' }, residuals: Array(12).fill({}), regressions: Array(3).fill({}) };
  const mutant = { ...structuredClone(admitted), passed: false, status: 'failed', workerSha256: 'c'.repeat(64),
    mutation: { name: 'remove-array-from' }, failure: { index: 37, input: { operation: 'Array.from', minimumCost: 42, state: { shape: { length: 32 } } } },
    error: 'cost undercharge for Array.from: actual 0, independent floor 42' };
  return { summary: { passed: true, seed: 1290300, cases: 100_000,
    runs: ['before', 'mutant', 'corrected'].map(mode => ({ mode, status: mode === 'mutant' ? 1 : 0, sha256: sha })) },
    proofs: { before: { report: admitted, sha256: sha }, mutant: { report: mutant, sha256: sha }, corrected: { report: structuredClone(admitted), sha256: sha } } };
}
test('P17 requires full current-source campaigns and a numerical, bounded real-row mutant', () => {
  const good = expression(); assert.equal(validateExpressionProof(good.summary, good.proofs, commit).passed, true);
  for (const mutate of [
    x => x.proofs.before.report.report.completed--,
    x => x.proofs.corrected.report.sourceCommit = 'c'.repeat(40),
    x => x.proofs.before.report.sourceClean = false,
    x => x.proofs.before.sha256 = 'c'.repeat(64),
    x => x.proofs.before.report.preflight.refusedNativeCalls = 1,
    x => x.proofs.mutant.report.error = 'worker timed out',
    x => x.proofs.mutant.report.failure.input.minimumCost = 0,
    x => x.proofs.mutant.report.failure.input.state.shape.length = 1_000_000,
    x => x.proofs.mutant.report.workerSha256 = sha,
    x => x.proofs.corrected.report.workerSha256 = 'c'.repeat(64),
  ]) { const x = expression(); mutate(x); assert.throws(() => validateExpressionProof(x.summary, x.proofs, commit)); }
});
