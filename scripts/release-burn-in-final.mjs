// Hosted provenance is deliberately separate from the pure burn-in report validator.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, digest, json, run, versionFiles } from './release-set.mjs';
import { auditInputManifest } from './release-audit.mjs';
import { authenticateRc, downloadRunEvidence, releaseReader, sha256 } from './release-burn-in-inputs.mjs';
import { hostileIds, fixtureCheckIds } from './release-burn-in-identities.mjs';
import { validateBurnInReport, readFuzzCompletion } from './release-burn-in-report.mjs';
import { requireSkewChecks } from './release-skew-drill.mjs';
import { securityHarnessHashes, validateHostileProof } from './release-security.mjs';

export function readBurnInReference(root = ROOT) {
  const path = join(root, 'docs/release/rc-burn-in.json');
  assert(statSync(path).isFile() && statSync(path).size <= 4 * 1024 * 1024, 'burn-in reference size');
  const bytes = readFileSync(path), reference = JSON.parse(bytes);
  assert.equal(reference.contract, 'rc-burn-in-reference-v1');
  assert.match(reference.rcTag ?? '', /^v3\.0\.0-rc\.[1-9][0-9]*$/);
  assert.match(reference.rcCommit ?? '', /^[a-f0-9]{40}$/); assert.match(reference.manifestSha256 ?? '', /^[a-f0-9]{64}$/);
  assert(Number.isSafeInteger(reference.runId) && reference.runId > 0 && Number.isSafeInteger(reference.runAttempt) && reference.runAttempt > 0);
  assert.equal(reference.finalVersion, '3.0.0');
  assert(Array.isArray(reference.reviewedChanges) && reference.reviewedChanges.length <= 10000);
  assert.equal(typeof reference.reviewEvidence?.content, 'string'); assert(reference.reviewEvidence.content.trim());
  assert.equal(sha256(Buffer.from(reference.reviewEvidence.content)), reference.reviewEvidence.sha256);
  return { bytes, reference, sha256: sha256(bytes), assetName: 'rc-burn-in-reference.json' };
}

export function finalDiffBinding(reference, finalCommit, root = ROOT) {
  assert.equal(reference.contract, 'rc-burn-in-reference-v1'); assert.match(reference.rcCommit ?? '', /^[a-f0-9]{40}$/);
  assert.equal(reference.finalVersion, '3.0.0'); assert.match(reference.rcTag ?? '', /^v3\.0\.0-rc\.[1-9][0-9]*$/);
  assert.equal(typeof reference.reviewEvidence?.content, 'string'); assert(reference.reviewEvidence.content.trim());
  assert.equal(sha256(Buffer.from(reference.reviewEvidence.content)), reference.reviewEvidence.sha256, 'final diff review evidence changed');
  run('git', ['merge-base', '--is-ancestor', reference.rcCommit, finalCommit], root);
  const before = auditInputManifest(reference.rcCommit, root), after = auditInputManifest(finalCommit, root);
  const scratch = mkdtempSync(join(tmpdir(), 'forma-final-diff-'));
  let versions;
  try {
    const archive = join(scratch, 'source.tar'); run('git', ['archive', '--format=tar', `--output=${archive}`, reference.rcCommit], root);
    run('tar', ['-xf', archive, '-C', scratch]);
    versions = versionFiles(scratch, '3.0.0');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const old = new Map(before.entries.map(row => [row.path, row])), current = new Map(after.entries.map(row => [row.path, row])), changes = [];
  for (const path of [...new Set([...old.keys(), ...current.keys()])].sort()) {
    const a = old.get(path), b = current.get(path); if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (path === 'docs/release/rc-burn-in.json') continue; // The reviewed reference cannot embed its own commit/blob.
    assert(a && b && a.mode === b.mode, `final adds/removes/changes mode: ${path}`);
    const bytes = run('git', ['show', `${finalCommit}:${path}`], root, { encoding: 'buffer' });
    if (versions.has(path)) assert.deepEqual(bytes, Buffer.from(versions.get(path)), `final version preparation differs: ${path}`);
    else if (path === 'scripts/release-contracts.json') {
      const x = JSON.parse(run('git', ['show', `${reference.rcCommit}:${path}`], root)), y = JSON.parse(bytes);
      for (const [name, gate] of Object.entries(x.milestones.final.gates)) {
        assert(['pending', 'done'].includes(gate.status)); assert.equal(y.milestones.final.gates[name].status, 'done'); gate.status = 'done';
      }
      assert.deepEqual(x, y, 'final changes release contract beyond final gate completion');
    } else assert(/^(?:docs\/(?!archive\/|evidence\/).+\.md|(?:README|CHANGELOG)\.md|(?:packages\/(?:core|compiler|build|create-app)|crates\/(?:forma-ir|forma-ir-derive|forma-server))\/(?:README|CHANGELOG)\.md|packages\/core\/(?:CSP|SECURITY)\.md)$/.test(path), `final product/harness drift: ${path}`);
    changes.push({ path, before: a.blob, afterSha256: sha256(bytes) });
  }
  for (const [path, text] of versions) assert.equal(run('git', ['show', `${finalCommit}:${path}`], root), text, `final version file not prepared: ${path}`);
  assert.deepEqual(changes, reference.reviewedChanges, 'actual final diff differs from independently reviewed binding');
  return changes;
}
export function validateFixtureProof(proof, expectedIds = fixtureCheckIds()) {
  const observed = [...proof.pages.pages.map(p => `fixture:${p.app}:${p.page}`), ...proof.pages.extras.map(name => `extra:${name}`), 'template:minimal:adoption', 'template:minimal:static', 'template:dashboard:interaction'];
  assert.deepEqual(expectedIds, fixtureCheckIds(), 'fixture expectations differ from authenticated source');
  assert.deepEqual(observed.sort(), expectedIds.slice().sort(), 'raw fixture cases differ');
  assert(proof.pages.pages.every(page => page.mutations === 0 && page.elements > 0));
  const { island, static: staticPage } = proof.templates.minimal;
  assert.deepEqual(island.errors, []); assert.deepEqual(island.violations, []);
  assert.deepEqual(island.transitions, [7, 8, 0, 1]); assert.deepEqual(island.adoption.mutations, []); assert.equal(island.adoption.sameNodes, true); assert.equal(island.adoption.sameHost, true);
  assert.equal(staticPage.executableScripts, 0); assert.equal(staticPage.modulepreloads, 0); assert.deepEqual(staticPage.errors, []); assert.deepEqual(staticPage.violations, []);
  assert.equal(proof.templates.dashboard.interacted, true); assert.deepEqual(proof.templates.dashboard.pageErrors, []); assert.deepEqual(proof.templates.dashboard.violations, []);
  const tooltip = proof.templates.dashboard.tooltip;
  assert.equal(tooltip?.apiTextStayedText, true, 'dashboard tooltip safety evidence missing');
  assert.deepEqual(tooltip.violations, { normal: [], hostile: [] }, 'dashboard navigation CSP evidence missing or violated');
  assert.deepEqual(tooltip.normal.map(point => point.hour), ['00:00', '23:00']);
  assert.equal(tooltip.hostile.hour, '<img data-forma-tooltip-probe src="/__forma_tooltip_probe__" onerror="globalThis.__formaTooltipExecuted=true">');
  for (const point of [...tooltip.normal, tooltip.hostile]) {
    assert.equal(point.hiddenOnLeave, true);
    assert(Array.isArray(point.values) && point.values.length === 2 && point.values.every(value => typeof value === 'string' && value.length > 0));
  }
  return proof;
}
export function validateBurnInFiles(directory, expected, report = json(join(directory, 'burn-in.json'))) {
  assert.deepEqual(expected.hostileCaseIds, hostileIds(), 'hostile expectation differs from authenticated source');
  assert.deepEqual(expected.fixtureCheckIds, fixtureCheckIds(), 'fixture expectation differs from authenticated source');
  validateBurnInReport(report, expected);
  for (const round of report.rounds) {
    const dir = join(directory, `round-${String(round.index).padStart(3, '0')}`);
    assert.deepEqual(json(join(dir, 'round.json')), round);
    for (const task of round.tasks) {
      const file = join(dir, `${task.id.replaceAll(':', '-')}.json`); assert.equal(digest(file), task.reportSha256);
      const proof = json(file);
      if (task.id.startsWith('fuzz:')) {
        const target = task.id.slice(5), log = join(dir, `${target}.log`); assert.equal(digest(log), proof.logSha256);
        const actual = readFuzzCompletion(readFileSync(log, 'utf8'), String(BigInt(task.finishedNs) - BigInt(task.startedNs)));
        for (const [key, value] of Object.entries(actual)) assert.equal(task[key], value);
        assert.equal(proof.target, target); assert.equal(proof.seed, task.seed);
      } else if (task.id === 'hostile') {
        validateHostileProof(proof, { commit: expected.sourceCommit, runtimeSha256: expected.runtimeSha256, harnessSources: securityHarnessHashes() });
      } else if (task.id.startsWith('skew:')) requireSkewChecks(proof);
      else {
        validateFixtureProof(proof, expected.fixtureCheckIds);
      }
    }
  }
  return report;
}
export async function verifyFinalBurnIn({ reference, commit, root = ROOT }) {
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit); assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no'], root).trim(), '');
  const changes = finalDiffBinding(reference, commit, root), directory = mkdtempSync(join(tmpdir(), 'forma-final-burn-in-'));
  try {
    const authenticated = await authenticateRc({ tag: reference.rcTag, commit: reference.rcCommit, directory: join(directory, 'rc'), root, checkoutRequired: false });
    const evidence = await downloadRunEvidence({ get: releaseReader(), runId: reference.runId, runAttempt: reference.runAttempt, name: 'rc-burn-in', manifestSha256: reference.manifestSha256, destination: join(directory, 'run'), commit: reference.rcCommit, tag: reference.rcTag, workflow: '.github/workflows/rc-burn-in.yml', event: 'workflow_dispatch', requiredJob: 'burn-in', requiredStep: 'Continuous packed RC workloads' });
    const expected = json(join(evidence.files, 'expected.json'));
    assert.equal(expected.rcTag, reference.rcTag); assert.equal(expected.sourceCommit, reference.rcCommit);
    for (const key of ['ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256']) assert.equal(expected[key], authenticated[key]);
    assert.deepEqual(expected.packages, authenticated.packages);
    const core = authenticated.packages.find(p => p.name === '@getforma/core');
    assert.equal(expected.runtimeSha256, sha256(run('tar', ['-xOf', join(authenticated.archives, core.file), 'package/dist/formajs-runtime.global.js'], root, { encoding: 'buffer' })), 'hostile runtime differs from original published archive');
    assert.equal(expected.harnessSha256, sha256(run('git', ['ls-tree', '-r', '-z', reference.rcCommit], root, { encoding: 'buffer' })));
    const report = validateBurnInFiles(evidence.files, expected);
    return { rcTag: reference.rcTag, rcCommit: reference.rcCommit, runId: reference.runId, runAttempt: reference.runAttempt, manifestSha256: reference.manifestSha256, artifactSha256: evidence.artifact.digest.slice(7), activeNanoseconds: report.activeNanoseconds, rounds: report.rounds.length, reviewedFinalChanges: changes, hostedAttestationVerified: true };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
