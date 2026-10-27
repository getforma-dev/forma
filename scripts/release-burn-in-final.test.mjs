import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFixtureProof, validateBurnInFiles } from './release-burn-in-final.mjs';
import { fixtureCheckIds, hostileIds, NATIVE_TEMPLATE_ENGINES } from './release-burn-in-identities.mjs';

function fixture(version = '3.1.0') {
  const ids = fixtureCheckIds(undefined, version);
  const result = {
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
        violations: { normal: [], hostile: [] },
        normal: [{ hour: '00:00', values: ['1,200', '12'], hiddenOnLeave: true }, { hour: '23:00', values: ['1,300', '10'], hiddenOnLeave: true }],
        hostile: { hour: '<img data-forma-tooltip-probe src="/__forma_tooltip_probe__" onerror="globalThis.__formaTooltipExecuted=true">', values: ['1,234', '7'], hiddenOnLeave: true },
      } },
    },
  };
  if (ids.some(id => id.startsWith('template:native-router:'))) result.templates['native-router'] = {
    engines: Object.fromEntries(NATIVE_TEMPLATE_ENGINES.map(engine => [engine, {
      typedNavigations: 3, navigationResponses: [200, 200, 200], scripts: 1,
      persistentLayout: true, removedLeafReset: true, noNewScripts: true, noJavaScript: true, errors: [], violations: [],
    }])),
  };
  if (ids.includes('template:dashboard:router')) result.templates.dashboard.tooltip.navigation = { links: true, sameRouteChart: true, persistentLayout: true, removedPageReset: true, backForward: true };
  return result;
}

test('3.2 burn-in requires complete native navigation outcomes in every engine while historical raw evidence remains valid', () => {
  for (const version of ['3.0.0-rc.5', '3.1.0-rc.3']) validateFixtureProof(fixture(version), fixtureCheckIds(undefined, version), version);
  const version = '3.2.0-rc.1', ids = fixtureCheckIds(undefined, version), original = fixture(version);
  validateFixtureProof(original, ids, version);
  assert.equal(ids.filter(id => id.startsWith('template:native-router:')).length, 3);
  assert.throws(() => validateFixtureProof(fixture(), ids, version), /inventory differs/);
  assert.throws(() => validateFixtureProof(original, fixtureCheckIds(), version), /expectations differ/);
  assert.throws(() => validateFixtureProof(original), /inventory differs/);
  for (const engine of NATIVE_TEMPLATE_ENGINES) for (const edit of [
    p => { delete p.templates['native-router'].engines[engine]; },
    p => { p.templates['native-router'].engines[engine].typedNavigations = 2; },
    p => { p.templates['native-router'].engines[engine].navigationResponses[1] = 500; },
    p => { p.templates['native-router'].engines[engine].scripts = 0; },
    ...['persistentLayout', 'removedLeafReset', 'noNewScripts', 'noJavaScript'].map(name => p => { p.templates['native-router'].engines[engine][name] = false; }),
    p => p.templates['native-router'].engines[engine].errors.push('late browser failure'),
    p => p.templates['native-router'].engines[engine].violations.push('script-src'),
  ]) { const changed = structuredClone(original); edit(changed); assert.throws(() => validateFixtureProof(changed, ids, version)); }
  for (const name of ['links', 'sameRouteChart', 'persistentLayout', 'removedPageReset', 'backForward']) {
    const changed = structuredClone(original); changed.templates.dashboard.tooltip.navigation[name] = false;
    assert.throws(() => validateFixtureProof(changed, ids, version), /dashboard router/);
  }
  const noDashboard = structuredClone(original); delete noDashboard.templates.dashboard.tooltip.navigation;
  assert.throws(() => validateFixtureProof(noDashboard, ids, version));
  const extra = structuredClone(original); extra.templates['native-router'].engines.other = extra.templates['native-router'].engines.chromium;
  assert.throws(() => validateFixtureProof(extra, ids, version), /all three engines/);
  assert.throws(() => validateBurnInFiles('/not-read', {rcTag: `v${version}`, hostileCaseIds: hostileIds(), fixtureCheckIds: fixtureCheckIds()}, {}), /fixture expectation differs/);
});

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
    p => { delete p.templates.dashboard.tooltip.violations; },
    p => { p.templates.dashboard.tooltip.violations.normal.push({ directive: 'script-src' }); },
    p => { p.templates.dashboard.tooltip.violations.hostile.push({ directive: 'require-trusted-types-for' }); },
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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT, versionFiles } from './release-set.mjs';
import { finalDiffBinding, readBurnInReference } from './release-burn-in-final.mjs';
import { checkReleaseQualification } from './check-release-qualification.mjs';
import { releaseLine, rcLine } from './release-line.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
function versionFixture(t, documents = {}, version = '3.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'burn-in-final-git-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet'); git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Finite control'); git('config', 'user.email', 'control@example.invalid');
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const [path, text] of versionFiles(ROOT, `${version}-rc.1`)) write(path, text);
  write('runtime.js', 'original product bytes\n');
  write('CHANGELOG.md', `# Synthetic changelog\n\n## [${version}]\n\nFinal fixture.\n\n## [${version}-rc.1]\n\nRC fixture.\n\n## [${version}-beta.1]\n\nBeta fixture.\n`);
  for (const [path, text] of Object.entries(documents)) write(path, text);
  write('scripts/release-contracts.json', JSON.stringify({ version, milestones: { final: { gates: { 'FORMA-145': { status: 'pending', scope: 'burn-in' } } } } }));
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic audited RC');
  const rcCommit = git('rev-parse', 'HEAD');
  for (const [path, text] of versionFiles(root, version)) write(path, text);
  write('scripts/release-contracts.json', JSON.stringify({ version, milestones: { final: { gates: { 'FORMA-145': { status: 'done', scope: 'burn-in' } } } } }));
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic final versions and gate');
  const finalCommit = git('rev-parse', 'HEAD');
  const reviewedChanges = commit => git('diff', '--name-only', rcCommit, commit).split('\n').sort().map(path => ({ path, before: git('rev-parse', `${rcCommit}:${path}`), afterSha256: sha(execFileSync('git', ['show', `${commit}:${path}`], { cwd: root })) }));
  const content = 'synthetic independent exact diff review';
  const reference = { contract: 'rc-burn-in-reference-v1', rcTag: `v${version}-rc.1`, rcCommit, finalVersion: version, reviewedChanges: reviewedChanges(finalCommit), reviewEvidence: { content, sha256: sha(content) }, runId: 123, runAttempt: 1, manifestSha256: 'a'.repeat(64) };
  return { root, git, write, reference, finalCommit, reviewedChanges };
}

test('exact coordinated final versions bind, while product drift and forged reviewed diffs refuse', t => {
  const f = versionFixture(t);
  assert.deepEqual(finalDiffBinding(f.reference, f.finalCommit, f.root), f.reference.reviewedChanges);
  assert.throws(() => finalDiffBinding({ ...f.reference, reviewedChanges: [] }, f.finalCommit, f.root), /reviewed binding/);
  f.write('runtime.js', 'changed product bytes\n'); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'forbidden product edit');
  assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), /product\/harness drift/);
});

test('existing release READMEs and core policy documents can update only with the exact reviewed final diff', t => {
  const paths = ['README.md',
    ...['core', 'compiler', 'build', 'create-app'].map(name => `packages/${name}/README.md`),
    ...['forma-ir', 'forma-ir-derive', 'forma-server'].map(name => `crates/${name}/README.md`),
    'packages/core/CSP.md', 'packages/core/SECURITY.md'];
  const documents = Object.fromEntries(paths.map(path => [path, readFileSync(join(ROOT, path), 'utf8')]));
  const f = versionFixture(t, documents);
  for (const [path, text] of Object.entries(documents)) f.write(path, `${text}\nFinal 3.0.0 release documentation.\n`);
  f.git('add', '.'); f.git('commit', '--quiet', '-m', 'synthetic reviewed release documentation');
  const commit = f.git('rev-parse', 'HEAD');
  const reference = { ...f.reference, reviewedChanges: f.reviewedChanges(commit) };
  assert.deepEqual(finalDiffBinding(reference, commit, f.root), reference.reviewedChanges);
  assert.throws(() => finalDiffBinding(f.reference, commit, f.root), /reviewed binding/);
});

test('release documentation permission does not admit production, config or other README paths', t => {
  const paths = ['runtime.js', 'packages/core/vite.config.ts', 'packages/other/README.md',
    'packages/core/docs/README.md', 'crates/README.md', 'SECURITY.md'];
  const f = versionFixture(t, Object.fromEntries(paths.map(path => [path, 'original bytes\n'])));
  for (const path of paths) {
    f.write(path, 'changed bytes\n'); f.git('add', '.'); f.git('commit', '--quiet', '-m', `forbidden edit ${path}`);
    assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), error => {
      assert.equal(error.message, `final product/harness drift: ${path}`); return true;
    });
    f.write(path, 'original bytes\n'); f.git('add', '.'); f.git('commit', '--quiet', '-m', `restore ${path}`);
  }
});

test('release documentation permission still refuses new paths and existing-file removal or mode changes', t => {
  const f = versionFixture(t, { 'README.md': 'original release documentation\n' });
  f.write('packages/core/README.md', 'new documentation\n'); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'new README');
  assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), /final adds\/removes\/changes mode: packages\/core\/README\.md/);
  f.git('rm', 'packages/core/README.md'); f.git('commit', '--quiet', '-m', 'remove new README');
  f.git('update-index', '--chmod=+x', 'README.md'); f.git('commit', '--quiet', '-m', 'executable README');
  assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), /final adds\/removes\/changes mode: README\.md/);
  f.git('rm', '-f', 'README.md'); f.git('commit', '--quiet', '-m', 'remove existing README');
  assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), /final adds\/removes\/changes mode: README\.md/);
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

test('release line parsing refuses noncanonical tags and cross-line RC evidence', () => {
  for (const tag of ['v2.9.0-rc.1', 'v3.01.0-rc.1', 'v3.1.00-rc.1', 'v3.1.0-rc.0', 'v3.1.0-rc.01', 'v3.1.0-dev', 'v3.1.0+metadata', '3.1.0', 'v3.1.0-rc.1\n']) assert.throws(() => releaseLine(tag));
  assert.equal(rcLine('v3.1.0-rc.1', '3.1.0').milestone, 'rc');
  for (const final of ['3.0.0', '3.1.1', '4.0.0', '3.1.0-rc.1']) assert.throws(() => rcLine('v3.1.0-rc.1', final));
  assert.throws(() => rcLine('v3.1.0-beta.1', '3.1.0'));
});

test('3.1 final requires same-line committed evidence, canonical version projection and real hosted authentication', async t => {
  const f = versionFixture(t, {}, '3.1.0');
  assert.deepEqual(finalDiffBinding(f.reference, f.finalCommit, f.root), f.reference.reviewedChanges);
  assert.throws(() => finalDiffBinding({ ...f.reference, rcTag: 'v3.0.0-rc.5' }, f.finalCommit, f.root), /lines differ/);
  await assert.rejects(checkReleaseQualification({ tag: 'v3.1.0', commit: f.finalCommit, root: f.root }), /ENOENT/);
  await assert.rejects(checkReleaseQualification({ tag: 'v3.0.0', commit: f.finalCommit, root: f.root }), /another version line/);
  await assert.rejects(checkReleaseQualification({ tag: 'v3.1.0-rc.1', commit: f.finalCommit, root: f.root }), /ENOENT/);
  assert.equal((await checkReleaseQualification({ tag: 'v3.1.0-beta.1', commit: f.finalCommit, root: f.root })).burnIn, 'required before final');
  f.write('docs/release/rc-burn-in.json', JSON.stringify(f.reference)); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'synthetic 3.1 immutable pointer');
  const commit = f.git('rev-parse', 'HEAD'); let calls = 0;
  assert.deepEqual(readBurnInReference(f.root, '3.1.0').reference, f.reference);
  assert.throws(() => readBurnInReference(f.root, '3.0.0'), /another final version/);
  await assert.rejects(checkReleaseQualification({ tag: 'v3.1.0', commit, root: f.root, finalReader: async args => {
    calls++; assert.deepEqual(args.reference, f.reference); throw Error('3.1 hosted authentication failed');
  } }), /hosted authentication failed/);
  assert.equal(calls, 1);
  f.write('runtime.js', 'post-RC product drift\n'); f.git('add', '.'); f.git('commit', '--quiet', '-m', 'forbidden 3.1 product edit');
  assert.throws(() => finalDiffBinding(f.reference, f.git('rev-parse', 'HEAD'), f.root), /product\/harness drift/);
});
