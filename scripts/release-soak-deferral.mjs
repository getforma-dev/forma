// One release-specific scheduling decision, not a general gate override.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SOAK_GATE = 'FORMA-145 soak';
export const SOAK_REFERENCE = 'docs/release/post-release-soak.json';
export const SOAK_CONTRACT = 'post-release-soak-reference-v1';
export const SOAK_POLICY = Object.freeze({ decision: 'L-66-QUOTA', finalVersion: '3.0.0', reference: SOAK_REFERENCE });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateSoakGate(gate, version, milestone = 'final', ticket = SOAK_GATE) {
  assert.equal(version, '3.0.0', 'soak deferral is only authorized for final 3.0.0');
  assert.equal(milestone, 'final'); assert.equal(ticket, SOAK_GATE);
  assert.equal(gate?.status, 'deferred');
  assert.deepEqual(gate.deferral, SOAK_POLICY, 'missing or different release-specific soak decision/reference');
  return gate.deferral;
}

export function validateSoakReference(reference) {
  assert.deepEqual(Object.keys(reference).sort(), ['contract', 'finalVersion', 'gate', 'decision', 'status', 'activeNanoseconds', 'requiredActiveNanoseconds', 'burnInPassed', 'rcTag', 'rcCommit', 'ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256', 'reviewedChanges', 'decisionEvidence', 'reviewEvidence'].sort(), 'unexpected/missing post-release soak reference field');
  assert.equal(reference.contract, SOAK_CONTRACT);
  assert.equal(reference.finalVersion, '3.0.0'); assert.equal(reference.gate, SOAK_GATE);
  assert.equal(reference.decision, SOAK_POLICY.decision); assert.equal(reference.status, 'deferred');
  assert.equal(reference.activeNanoseconds, '0', 'deferral earns no active work credit');
  assert.equal(reference.requiredActiveNanoseconds, '3600000000000');
  assert.equal(reference.burnInPassed, false, 'deferred soak is not passed');
  assert.match(reference.rcTag ?? '', /^v3\.0\.0-rc\.[1-9][0-9]*$/);
  assert.match(reference.rcCommit ?? '', /^[a-f0-9]{40}$/);
  for (const key of ['ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256']) assert.match(reference[key] ?? '', /^[a-f0-9]{64}$/, `missing published RC ${key}`);
  assert(Array.isArray(reference.reviewedChanges) && reference.reviewedChanges.length <= 10000);
  for (const key of ['decisionEvidence', 'reviewEvidence']) {
    assert.equal(typeof reference[key]?.content, 'string'); assert(reference[key].content.trim());
    assert.equal(sha256(Buffer.from(reference[key].content)), reference[key].sha256, `${key} bytes changed`);
  }
  return reference;
}

export function readSoakDeferral(root, contracts, version = '3.0.0') {
  assert.equal(contracts?.version, '3.0.0');
  validateSoakGate(contracts.milestones?.final?.gates?.[SOAK_GATE], version);
  assert(!existsSync(join(root, 'docs/release/rc-burn-in.json')), 'deferred and completed burn-in references cannot coexist');
  const path = join(root, SOAK_REFERENCE), stat = lstatSync(path);
  assert(stat.isFile() && stat.size <= 4 * 1024 * 1024, 'post-release soak reference size/type');
  const bytes = readFileSync(path), reference = validateSoakReference(JSON.parse(bytes));
  return { bytes, reference, sha256: sha256(bytes), assetName: 'post-release-soak-reference.json' };
}

export function soakDisposition(reference) {
  validateSoakReference(reference);
  return { status: 'deferred', decision: reference.decision, gate: reference.gate,
    finalVersion: reference.finalVersion, rcTag: reference.rcTag, rcCommit: reference.rcCommit,
    activeNanoseconds: '0', requiredActiveNanoseconds: reference.requiredActiveNanoseconds, burnInPassed: false,
    ds12Sha256: reference.ds12Sha256, p17EvidenceSha256: reference.p17EvidenceSha256, d14EvidenceSha256: reference.d14EvidenceSha256 };
}
