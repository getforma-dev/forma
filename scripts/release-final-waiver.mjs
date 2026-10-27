// One explicit human scheduling decision. No generic gate or environment bypass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FINAL_WAIVER_GATES = Object.freeze(['FORMA-145 soak', 'FORMA-301 N7']);
export const FINAL_WAIVER_POLICY = Object.freeze({
  decision: 'FORMA-3.2-STREAMLINED-RELEASE-20261027',
  finalVersion: '3.2.0',
  reference: 'docs/release/3.2-STREAMLINED-RELEASE.json',
  sha256: 'f1ff0da25d3771916c4326b40141ca8220c81a3900af76a9b3ccb49482726b8e',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function usesFinalWaiver(contracts) {
  return FINAL_WAIVER_GATES.some(ticket => contracts?.milestones?.final?.gates?.[ticket]?.status === 'waived');
}

export function validateFinalWaiverGate(gate, version, milestone, ticket) {
  assert.equal(version, '3.2.0', 'waiver is only authorized for final 3.2.0');
  assert.equal(milestone, 'final', 'waiver is only a final gate disposition');
  assert(FINAL_WAIVER_GATES.includes(ticket), 'this gate is not waived by the 3.2 decision');
  assert.deepEqual(Object.keys(gate).sort(), ['scope', 'status', 'waiver']);
  assert.equal(gate.status, 'waived');
  assert.equal(typeof gate.scope, 'string'); assert(gate.scope.trim(), 'waived gate needs its actual scope');
  assert.deepEqual(gate.waiver, FINAL_WAIVER_POLICY, 'missing or different exact 3.2 waiver decision');
  return gate.waiver;
}

/** Both preflight and DS12 bind the same regular committed decision and contract.
 * The SHA fixes the human instruction as transcribed; it is not a signature.
 * The caller still requires a ready milestone and the actual final-source audit.
 */
export function readFinalWaiver({ root, contracts, version, commit }) {
  assert.equal(version, '3.2.0'); assert.equal(contracts.version, version);
  assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'exact final commit required');
  for (const ticket of FINAL_WAIVER_GATES) validateFinalWaiverGate(contracts.milestones?.final?.gates?.[ticket], version, 'final', ticket);
  const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), commit, 'waiver checkout differs from final source');
  assert.deepEqual(JSON.parse(git('show', `${commit}:scripts/release-contracts.json`)), contracts, 'waiver contract differs from committed source');
  const path = join(root, FINAL_WAIVER_POLICY.reference), stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024, 'waiver decision must be a bounded regular file');
  assert.match(git('ls-tree', commit, '--', FINAL_WAIVER_POLICY.reference).toString(), /^100644 blob [a-f0-9]{40}\t/, 'waiver decision must be a committed regular file');
  const bytes = readFileSync(path);
  assert.equal(sha256(bytes), FINAL_WAIVER_POLICY.sha256, 'waiver decision bytes differ from actual human instruction');
  assert.deepEqual(bytes, git('show', `${commit}:${FINAL_WAIVER_POLICY.reference}`), 'waiver decision differs from committed source');
  const decision = JSON.parse(bytes);
  assert.equal(decision.decision, FINAL_WAIVER_POLICY.decision);
  return { bytes, sha256: sha256(bytes), assetName: '3.2-streamlined-release.json', disposition: {
    status: 'waived', decision: decision.decision, finalVersion: version,
    gates: [...FINAL_WAIVER_GATES], authority: decision.authority,
    activeSoak: { requiredActiveSeconds: 3600, creditedActiveSeconds: 0, passed: false },
    n7TwentyRunCampaign: { completedCampaignForCurrentSource: false, passed: false },
    preStableExtraRcPublication: 'waived', stagedProductionRollbackExercise: 'waived',
    futureSoakRequiredByThisDecision: false, historicalOutcomesReclassified: false,
  } };
}
