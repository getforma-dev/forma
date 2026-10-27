#!/usr/bin/env node
// Pre-publication qualification. Pending checklist text cannot substitute for evidence.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, run, json, assertMilestoneReady } from './release-set.mjs';
import { readRcAudit } from './release-audit.mjs';
import { SOAK_GATE, readSoakDeferral } from './release-soak-deferral.mjs';
import { releaseLine } from './release-line.mjs';
import { changelogEntry } from './release-record.mjs';

export async function checkReleaseQualification({ tag, commit, root = ROOT, finalReader, deferredReader } = {}) {
  assert.match(commit ?? '', /^[a-f0-9]{40}$/); assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit);
  const line = releaseLine(tag), contracts = json(join(root, 'scripts/release-contracts.json'));
  assert.equal(contracts.version, line.finalVersion, 'release qualification contract names another version line');
  // DS12 uses this same parser after publication. Refuse an unrecordable tag
  // before either publisher, binding the entry to committed source, not a local patch.
  changelogEntry(run('git', ['show', `${commit}:CHANGELOG.md`], root), line.version);
  if (line.milestone === 'rc') return { milestone: 'rc', audit: readRcAudit(commit, root).binding };
  if (line.milestone === 'final') {
    const module = await import('./release-burn-in-final.mjs');
    if (contracts.milestones?.final?.gates?.[SOAK_GATE]?.status === 'deferred') {
      assertMilestoneReady(contracts, line.version);
      const { reference } = readSoakDeferral(root, contracts);
      return { milestone: 'final', postReleaseSoak: await (deferredReader ?? module.verifyFinalSoakDeferral)({ reference, commit, root }) };
    }
    const { reference } = module.readBurnInReference(root, line.version);
    const verify = finalReader ?? module.verifyFinalBurnIn;
    return { milestone: 'final', burnIn: await verify({ reference, commit, root }) };
  }
  return { milestone: line.milestone, audit: 'required before RC', burnIn: 'required before final' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkReleaseQualification({ tag: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
