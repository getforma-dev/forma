// D14 is an actual independent review. This module validates its recorded
// provenance and exact Git inputs; it cannot manufacture a model's review.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, run } from './release-set.mjs';

export const AUDIT_FILES = ['d14-report.json', 'd14-input-manifest.json', 'd14-rc-binding.json', 'd14-review-evidence.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = (value, label) => assert.match(value ?? '', /^[a-f0-9]{64}$/, `${label}: SHA-256 required`);
const oid = value => assert.match(value ?? '', /^[a-f0-9]{40}$/, 'exact Git identity required');
function timestamp(value) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  assert.equal(new Date(value).toISOString().slice(0, 19), value.slice(0, 19), 'invalid review time');
}
function model(value) {
  assert(value && typeof value === 'object');
  for (const key of ['provider', 'id', 'sessionEvidenceSha256']) assert.equal(typeof value[key], 'string');
  assert(value.provider.trim() && value.id.trim()); hash(value.sessionEvidenceSha256, 'actual model session evidence');
  return `${value.provider}:${value.id}`;
}
const documentation = path => /^(?:docs\/(?!archive\/|evidence\/).+\.md|docs\/release\/d14-(?:report|input-manifest|review-evidence)\.json|CHANGELOG\.md|packages\/(?:core|compiler|build|create-app)\/CHANGELOG\.md|crates\/(?:forma-ir|forma-ir-derive|forma-server)\/CHANGELOG\.md)$/.test(path);

/** An input manifest covers every tracked blob, including modes. */
export function auditInputManifest(commit, root = ROOT) {
  oid(commit);
  const tree = run('git', ['rev-parse', `${commit}^{tree}`], root).trim(); oid(tree);
  const entries = run('git', ['ls-tree', '-r', '-z', commit], root).split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    assert(match, 'audit input contains a submodule, link or unsupported mode');
    return { path: match[3], mode: match[1], blob: match[2] };
  });
  assert(entries.length > 0);
  return { contract: 'd14-input-manifest-v1', commit, tree, entries };
}

export function validateAuditReport(report, input, inputBytes) {
  assert.equal(report.contract, 'd14-whole-release-v1');
  assert.equal(input.contract, 'd14-input-manifest-v1'); oid(input.commit); oid(input.tree);
  assert.equal(report.reviewedCommit, input.commit); assert.equal(report.reviewedTree, input.tree);
  hash(report.inputManifestSha256, 'D14 input manifest');
  assert.equal(report.inputManifestSha256, sha(inputBytes));
  assert.notEqual(model(report.authorModel), model(report.reviewerModel), 'D14 requires a different model');
  timestamp(report.reviewedAt);
  assert.equal(report.accepted, true, 'D14 review is not accepted');
  assert(Array.isArray(report.findings)); assert(report.findings.length <= 10_000);
  const ids = new Set();
  for (const finding of report.findings) {
    assert.match(finding.id ?? '', /^[A-Za-z][A-Za-z0-9._-]{0,79}$/); assert(!ids.has(finding.id)); ids.add(finding.id);
    assert(['critical', 'high', 'medium', 'low', 'info'].includes(finding.severity));
    assert(['resolved', 'nonblocking'].includes(finding.disposition), `unresolved D14 finding ${finding.id}`);
    assert.equal(typeof finding.rationale, 'string'); assert(finding.rationale.trim());
    hash(finding.evidenceSha256, `finding ${finding.id} evidence`);
    if (['critical', 'high'].includes(finding.severity)) assert.equal(finding.disposition, 'resolved');
  }
  assert.deepEqual(report.blockingFindings, [], 'D14 still has blockers');
  // This pins the actual accepted review/session evidence. Authenticity is
  // supplied by the independently reviewed RC source and GitHub asset digests.
  hash(report.acceptanceEvidenceSha256, 'accepted independent review evidence');
  return report;
}

/** Evidence can follow the audit without asking a file to contain its own hash.
 * RC versions must already be prepared at the audited commit. No normalization
 * permits a changed production or harness blob to masquerade as version data.
 */
export function bindAuditToRc({ rcCommit, reportBytes, inputBytes, root = ROOT }) {
  oid(rcCommit);
  const report = JSON.parse(reportBytes), input = JSON.parse(inputBytes);
  validateAuditReport(report, input, inputBytes);
  assert.deepEqual(input, auditInputManifest(input.commit, root), 'D14 inputs differ from actual Git objects');
  run('git', ['merge-base', '--is-ancestor', input.commit, rcCommit], root);
  const after = auditInputManifest(rcCommit, root), old = new Map(input.entries.map(row => [row.path, row]));
  const current = new Map(after.entries.map(row => [row.path, row]));
  const changes = [];
  for (const path of [...new Set([...old.keys(), ...current.keys()])].sort()) {
    const before = old.get(path), next = current.get(path);
    if (JSON.stringify(before) === JSON.stringify(next)) continue;
    if (path === 'scripts/release-contracts.json') {
      assert(before && next && before.mode === next.mode);
      const a = JSON.parse(run('git', ['show', `${input.commit}:${path}`], root));
      const b = JSON.parse(run('git', ['show', `${rcCommit}:${path}`], root));
      assert.equal(a.milestones.rc.gates['FORMA-145 audit'].status, 'pending');
      assert.equal(b.milestones.rc.gates['FORMA-145 audit'].status, 'done');
      a.milestones.rc.gates['FORMA-145 audit'].status = 'done';
      assert.deepEqual(a, b, 'non-audit gate change after D14');
    } else assert(documentation(path), `production/harness changed after D14: ${path}`);
    changes.push({ path, before: before ?? null, after: next ?? null });
  }
  return { contract: 'd14-rc-binding-v1', reviewedCommit: input.commit, reviewedTree: input.tree,
    rcCommit, rcTree: after.tree, reportSha256: sha(reportBytes), inputManifestSha256: sha(inputBytes), changes };
}

export function validateAuditEvidence(report, evidenceBytes) {
  const evidence = JSON.parse(evidenceBytes);
  assert.equal(evidence.contract, 'd14-review-evidence-v1');
  const expected = new Set([report.authorModel.sessionEvidenceSha256, report.reviewerModel.sessionEvidenceSha256,
    report.acceptanceEvidenceSha256, ...report.findings.map(finding => finding.evidenceSha256)]);
  assert(Array.isArray(evidence.entries) && evidence.entries.length === expected.size);
  for (const item of evidence.entries) {
    assert.equal(typeof item.content, 'string'); assert(item.content.trim().length > 0);
    assert.equal(sha(Buffer.from(item.content)), item.sha256, 'D14 raw review evidence changed');
    assert(expected.delete(item.sha256), 'unexpected or duplicated D14 review evidence');
  }
  assert.equal(expected.size, 0, 'D14 actual review evidence missing');
  return sha(evidenceBytes);
}

export function readRcAudit(rcCommit, root = ROOT) {
  const reportBytes = readFileSync(join(root, 'docs/release/d14-report.json'));
  const inputBytes = readFileSync(join(root, 'docs/release/d14-input-manifest.json'));
  const binding = bindAuditToRc({ rcCommit, reportBytes, inputBytes, root });
  const evidenceBytes = readFileSync(join(root, 'docs/release/d14-review-evidence.json'));
  binding.reviewEvidenceSha256 = validateAuditEvidence(JSON.parse(reportBytes), evidenceBytes);
  return { reportBytes, inputBytes, evidenceBytes, binding };
}
