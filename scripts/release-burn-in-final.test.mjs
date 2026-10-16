import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFixtureProof, validateBurnInFiles } from './release-burn-in-final.mjs';
import { fixtureCheckIds, hostileIds } from './release-burn-in-identities.mjs';

function fixture() {
  const ids = fixtureCheckIds();
  return {
    pages: {
      pages: ids.filter(id => id.startsWith('fixture:')).map(id => {
        const [_, app, ...page] = id.split(':');
        return { app, page: page.join(':'), mutations: 0, elements: 1 };
      }),
      extras: ids.filter(id => id.startsWith('extra:')).map(id => id.slice(6)),
    },
    templates: {
      minimal: {
        island: { errors: [], violations: [], transitions: [7, 8, 0, 1], adoption: { mutations: [], sameNodes: true, sameHost: true } },
        static: { errors: [], violations: [], executableScripts: 0, modulepreloads: 0 },
      },
      dashboard: { interacted: true, pageErrors: [], violations: [], tooltip: {
        apiTextStayedText: true,
        normal: [{ hour: '00:00', values: ['1,200', '12'], hiddenOnLeave: true }, { hour: '23:00', values: ['1,300', '10'], hiddenOnLeave: true }],
        hostile: { hour: '<img data-forma-tooltip-probe src="/__forma_tooltip_probe__" onerror="globalThis.__formaTooltipExecuted=true">', values: ['1,234', '7'], hiddenOnLeave: true },
      } },
    },
  };
}

test('raw fixture evidence must retain every independent source case and real behavior outcome', () => {
  const original = fixture(); validateFixtureProof(original);
  for (const edit of [
    p => { p.pages.pages = []; }, p => p.pages.extras.pop(),
    p => { p.pages.pages[0].mutations = 1; }, p => { p.pages.pages[0].elements = 0; },
    p => { p.templates.minimal.island.adoption.sameNodes = false; },
    p => p.templates.minimal.island.errors.push('runtime failed'),
    p => { p.templates.minimal.static.executableScripts = 1; },
    p => { p.templates.dashboard.interacted = false; },
    p => { delete p.templates.dashboard.tooltip; },
    p => { p.templates.dashboard.tooltip.apiTextStayedText = false; },
    p => { p.templates.dashboard.tooltip.normal.pop(); },
    p => { p.templates.dashboard.tooltip.hostile.hour = 'safe'; },
    p => { p.templates.dashboard.tooltip.hostile.hiddenOnLeave = false; },
  ]) { const changed = structuredClone(original); edit(changed); assert.throws(() => validateFixtureProof(changed)); }
  assert.throws(() => validateFixtureProof(original, []), /expectations differ/);
});

test('a self-supplied empty expected case list refuses before accepting a report or reading files', () => {
  assert.throws(() => validateBurnInFiles('/not-read', { hostileCaseIds: [], fixtureCheckIds: [] }, {}), /hostile expectation differs/);
  assert.throws(() => validateBurnInFiles('/not-read', { hostileCaseIds: hostileIds(), fixtureCheckIds: [] }, {}), /fixture expectation differs/);
});

// Real Git objects and the existing version-preparation function exercise the
// final handoff; this is synthetic provenance, never a real D14 acceptance.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT, versionFiles } from './release-set.mjs';
import { finalDiffBinding } from './release-burn-in-final.mjs';
import { checkReleaseQualification } from './check-release-qualification.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
function versionFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'burn-in-final-git-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet'); git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Finite control'); git('config', 'user.email', 'control@example.invalid');
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const [path, text] of versionFiles(ROOT, '3.0.0-rc.1')) write(path, text);
  write('runtime.js', 'original product bytes\n');
  write('scripts/release-contracts.json', JSON.stringify({ milestones: { final: { gates: { 'FORMA-145': { status: 'pending', scope: 'burn-in' } } } } }));
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic audited RC');
  const rcCommit = git('rev-parse', 'HEAD');
  for (const [path, text] of versionFiles(root, '3.0.0')) write(path, text);
  write('scripts/release-contracts.json', JSON.stringify({ milestones: { final: { gates: { 'FORMA-145': { status: 'done', scope: 'burn-in' } } } } }));
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic final versions and gate');
  const finalCommit = git('rev-parse', 'HEAD');
  const changes = git('diff', '--name-only', rcCommit, finalCommit).split('\n').sort().map(path => ({ path, before: git('rev-parse', `${rcCommit}:${path}`), afterSha256: sha(execFileSync('git', ['show', `${finalCommit}:${path}`], { cwd: root })) }));
  const content = 'synthetic independent exact diff review';
  const reference = { contract: 'rc-burn-in-reference-v1', rcTag: 'v3.0.0-rc.1', rcCommit, finalVersion: '3.0.0', reviewedChanges: changes, reviewEvidence: { content, sha256: sha(content) }, runId: 123, runAttempt: 1, manifestSha256: 'a'.repeat(64) };
  return { root, git, write, reference, finalCommit };
}

test('exact coordinated final versions bind, while product drift and forged reviewed diffs refuse', t => {
  const f = versionFixture(t);
  assert.deepEqual(finalDiffBinding(f.reference, f.finalCommit, f.root), f.reference.reviewedChanges);
  assert.throws(() => finalDiffBinding({ ...f.reference, reviewedChanges: [] }, f.finalCommit, f.root), /reviewed binding/);
  f.write('runtime.js', 'changed product bytes\n'); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'forbidden product edit');
  assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), /product\/harness drift/);
});

test('pre-publication final dispatch requires the actual pointer and propagates failed hosted authentication', async t => {
  const f = versionFixture(t);
  await assert.rejects(checkReleaseQualification({ tag: 'v3.0.0', commit: f.finalCommit, root: f.root }), /ENOENT/);
  f.write('docs/release/rc-burn-in.json', JSON.stringify(f.reference)); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'synthetic immutable pointer');
  const commit = f.git('rev-parse', 'HEAD'); let calls = 0;
  await assert.rejects(checkReleaseQualification({ tag: 'v3.0.0', commit, root: f.root, finalReader: async args => {
    calls++; assert.deepEqual(args.reference, f.reference); assert.equal(args.commit, commit); throw Error('hosted source is wrong');
  } }), /hosted source is wrong/);
  assert.equal(calls, 1);
  await assert.rejects(checkReleaseQualification({ tag: 'v3.0.0-rc.0', commit, root: f.root }), /unknown/);
  await assert.rejects(checkReleaseQualification({ tag: 'v3.0.0-rc.1', commit, root: f.root }), /ENOENT/);
});
