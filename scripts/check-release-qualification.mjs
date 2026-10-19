#!/usr/bin/env node
// Pre-publication qualification. Pending checklist text cannot substitute for evidence.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, run, json, assertMilestoneReady } from './release-set.mjs';
import { readRcAudit } from './release-audit.mjs';
import { SOAK_GATE, readSoakDeferral } from './release-soak-deferral.mjs';

export async function checkReleaseQualification({ tag, commit, root = ROOT, finalReader, deferredReader } = {}) {
  assert.match(commit ?? '', /^[a-f0-9]{40}$/); assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit);
  if (/^v3\.0\.0-rc\.[1-9][0-9]*$/.test(tag)) return { milestone: 'rc', audit: readRcAudit(commit, root).binding };
  if (tag === 'v3.0.0') {
    const module = await import('./release-burn-in-final.mjs');
    const contracts = json(join(root, 'scripts/release-contracts.json'));
    if (contracts.milestones?.final?.gates?.[SOAK_GATE]?.status === 'deferred') {
      assertMilestoneReady(contracts, '3.0.0');
      const { reference } = readSoakDeferral(root, contracts);
      return { milestone: 'final', postReleaseSoak: await (deferredReader ?? module.verifyFinalSoakDeferral)({ reference, commit, root }) };
    }
    const { reference } = module.readBurnInReference(root);
    const verify = finalReader ?? module.verifyFinalBurnIn;
    return { milestone: 'final', burnIn: await verify({ reference, commit, root }) };
  }
  assert(/^v3\.0\.0-(?:alpha|beta)\.[1-9][0-9]*$/.test(tag), 'unknown release qualification milestone');
  return { milestone: tag.includes('-alpha.') ? 'alpha' : 'beta', audit: 'required before RC', burnIn: 'required before final' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkReleaseQualification({ tag: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
