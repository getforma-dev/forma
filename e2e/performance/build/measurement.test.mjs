import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, delimiter } from 'node:path';
import { sources, assertGraph, expectedFor, REVISION, NEXT_REVISION } from './workload.mjs';
import { POLICY, aggregate, assertDependencyGraph, assertFreshApplication, assertPage, observeUpdate, observeAffected, assertUnchangedPage } from './measurement.mjs';

const source = 'a'.repeat(40);
const inventory = assertGraph(sources());
const sample = number => ({
  result: { sample: number, source, runId: '123', attempt: 1, policy: POLICY, pilot: false, complete: true, freshApplicationVerified: true, releaseEmbeddingVerified: true, semanticChecksPassed: true, failures: [], inventory,
    fullBuildMs: 100, update: { servedMs: 20, visibleMs: 30 },
    profile: { platform: 'linux', arch: 'x64', logicalCpus: 4, cargoJobs: 4, node: 'v24.22.0', rust: 'rustc 1.99.1 (synthetic fixture)', imageOS: 'ubuntu24', imageVersion: 'synthetic', chromium: 'synthetic', cpu: 'synthetic', memoryBytes: 1024 } },
  supervisor: { complete: true, exitCode: 0, faults: [], cleanup: { complete: true } },
});
const twenty = () => Array.from({ length: 20 }, (_, i) => sample(i + 1));

test('fixed workload has300 unique reachable definitions; dead imports and missing rendered components refuse', () => {
  assert.equal(inventory.length, 300);
  for (const edit of [
    files => files.delete('shared/Shared00.tsx'),
    files => files.set('page00/app.tsx', files.get('page00/app.tsx').replace('<Shared00 />', '')),
    files => files.set('page00/app.tsx', files.get('page00/app.tsx').replace("import { Shared00 } from '../shared/Shared00.tsx';", '')),
    files => files.set('shared/Shared00.tsx', files.get('shared/Shared00.tsx').replace('data-n7-component="Shared00"', '')),
  ]) { const files = sources(); edit(files); assert.throws(() => assertGraph(files)); }
});

test('dependency roots must have identical specs/features/resolution; actual manifests and helper contain no application', () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const app = readFileSync(join(root, 'app/Cargo.toml'), 'utf8').split('[dependencies]')[1];
  assert.equal(app, readFileSync(join(root, 'dependencies/Cargo.toml'), 'utf8').split('[dependencies]')[1]);
  assert(!app.includes('debug-embed'));
  assert.match(readFileSync(join(root, 'dependencies/src/main.rs'), 'utf8'), /fn main\(\) \{\}/);
  const metadata = { packages: [
    { name: 'forma-n7-a9', id: 'app', dependencies: [{ name: 'dep', features: ['a'] }], targets: [{ kind: ['bin'] }] },
    { name: 'forma-n7-dependencies', id: 'helper', dependencies: [{ name: 'dep', features: ['a'] }], targets: [{ kind: ['bin'] }] },
  ], resolve: { nodes: [{ id: 'app', deps: ['dep'], features: [] }, { id: 'helper', deps: ['dep'], features: [] }] } };
  assert.deepEqual(assertDependencyGraph(metadata), { appId: 'app', helperId: 'helper' });
  metadata.packages[1].dependencies[0].features.push('different');
  assert.throws(() => assertDependencyGraph(metadata), /specifications/);
});

test('fresh application proof refuses prepared app messages, nested fingerprints/objects and output without deleting them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-n7-fresh-'));
  try {
    const target = join(dir, 'target'), dist = join(dir, 'dist');
    mkdirSync(target);
    assertFreshApplication(target, dist, '{"reason":"compiler-artifact","package_id":"dependency"}\n', 'app');
    assert.throws(() => assertFreshApplication(target, dist, '{"reason":"compiler-artifact","package_id":"app"}', 'app'), /compiled/);
    const fingerprint = join(target, 'release/.fingerprint/forma-n7-a9-abc');
    mkdirSync(fingerprint, { recursive: true }); writeFileSync(join(fingerprint, 'bin-forma-n7-a9'), 'retained');
    assert.throws(() => assertFreshApplication(target, dist, '', 'app'), /artifact/);
    assert.equal(readFileSync(join(fingerprint, 'bin-forma-n7-a9'), 'utf8'), 'retained');
    rmSync(target, { recursive: true }); mkdirSync(dist);
    assert.throws(() => assertFreshApplication(target, dist, '', 'app'), /dist/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const html = revision => '<h1><!--f:t0-->Workspace 0<!--/f:t0--></h1><li data-forma-key="1"><!--f:t2-->Open<!--/f:t2--></li><li data-forma-key="2"><!--f:t2-->Closed<!--/f:t2--></li><p class="notice">Pending review</p>' + expectedFor(0).map(name => `<aside data-n7-component="${name}">${name === 'Shared00' ? revision : 'content'}</aside>`).join('');
test('real observation loop includes save, polling, HTTP and reload/frame time; IR-only, wrong-route and reload failures cannot pass', async () => {
  let clock = 7, calls = 0;
  const rows = [];
  const result = await observeUpdate({ started: 0, now: () => clock,
    read: async () => { clock += 4; return { status: 200, html: html(++calls === 2 ? NEXT_REVISION : REVISION) }; },
    delay: async () => { clock += 10; }, record: row => rows.push(row),
    reloadAndFrame: async () => { clock += 40; },
  });
  assert.deepEqual(result, { servedMs: 25, visibleMs: 65 }); assert.equal(rows.length, 2);
  clock = 0;
  await assert.rejects(observeUpdate({ started: 0, now: () => clock, deadlineMs: 20, record() {},
    read: async () => ({ status: 200, html: html(REVISION) }), delay: async () => { clock += 10; },
    reloadAndFrame: async () => assert.fail('IR-only old page cannot reload successfully'),
  }), /deadline/);
  for (const body of [html(NEXT_REVISION).replace('Page00', 'Page01'), html(REVISION) + NEXT_REVISION]) {
    await assert.rejects(observeUpdate({ started: 0, now: () => 0, read: async () => ({ status: 200, html: body }), record() {}, delay: async () => {}, reloadAndFrame: async () => {} }));
  }
  await assert.rejects(observeUpdate({ started: 0, now: () => 0, read: async () => ({ status: 200, html: html(NEXT_REVISION) }), record() {}, reloadAndFrame: async () => { throw new Error('browser reload failed'); } }), /reload failed/);
});

test('all20 original samples are necessary; strict p95 boundaries retain slow maxima, with no pooling or failed-row omission', () => {
  const rows = twenty(); rows[19].result.fullBuildMs = 90_000;
  assert.equal(aggregate(rows, source).passed, true); assert.equal(aggregate(rows, source).fullBuild.max, 90_000);
  rows[18].result.fullBuildMs = 30_000; assert.equal(aggregate(rows, source).passed, false);
  rows[18].result.fullBuildMs = 29_999; rows[18].result.update = { servedMs: 20, visibleMs: 1000 }; rows[19].result.update = { servedMs: 20, visibleMs: 1000 };
  assert.equal(aggregate(rows, source).passed, false);
  for (const change of [
    rows => rows.pop(), rows => { rows[0].result.inventory = Array.from({ length: 300 }, (_, i) => `dummy${i}`); }, rows => { rows[0].result.releaseEmbeddingVerified = false; }, rows => { rows[0].result.complete = false; }, rows => { rows[0].supervisor.complete = false; },
    rows => { rows[0].result.runId = '124'; }, rows => { rows[0].result.attempt = 2; }, rows => { rows[0].result.source = 'b'.repeat(40); },
    rows => { rows[0].result.sample = 2; }, rows => { rows[0].result.profile.chromium = 'other'; }, rows => { rows[0].result.fullBuildMs = NaN; },
  ]) { const input = twenty(); change(input); assert.throws(() => aggregate(input, source)); }
});

test('manual workflow retains twenty independent first-attempt samples, exact source, existing ownership and always-upload; no publisher', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/n7-build-loop.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert(!/^  (?:push|pull_request|schedule):/m.test(workflow));
  assert.match(workflow, /contents: read/);
  assert(!/secrets\.|id-token:|packages: write|npm publish|cargo publish/.test(workflow));
  assert.match(workflow, /fail-fast: false/); assert.match(workflow, /max-parallel: 10/);
  const ids = /sample: \[([^\]]+)\]/.exec(workflow)[1].split(',').map(Number);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.match(workflow, /test "\$GITHUB_RUN_ATTEMPT" = 1/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$N7_SOURCE"/);
  assert.match(workflow, /release-owned-linux\.py[^\n]+900 -- node e2e\/performance\/build\/run\.mjs sample/);
  assert.equal((workflow.match(/if: always\(\)/g) ?? []).length, 3);
});

// GitHub's explicit `shell: bash` uses this error/pipe mode. Exercise the actual
// workflow run block, including tee, against real finite aggregate inputs.
test('actual workflow aggregation shell keeps a p95 failure nonzero and retains raw samples plus aggregate output', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/n7-build-loop.yml', import.meta.url), 'utf8');
  const block = /- name: Validate every original sample and both strict p95 thresholds\n        shell: bash\n        run: \|\n((?:          .*\n)+)/.exec(workflow);
  assert(block, 'aggregation must explicitly select Bash pipefail behavior');
  const script = block[1].replace(/^          /gm, '');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const actualSource = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const directory = mkdtempSync(join(tmpdir(), 'forma-n7-aggregate-'));
  try {
    const output = join(directory, 'n7-results'); mkdirSync(output);
    const rows = twenty();
    rows[18].result.fullBuildMs = rows[19].result.fullBuildMs = 30_000;
    for (const row of rows) {
      row.result.source = actualSource;
      const path = join(output, `n7-sample-${row.result.sample}`);
      mkdirSync(join(path, 'measurement'), { recursive: true }); mkdirSync(join(path, 'owned'));
      writeFileSync(join(path, 'measurement/result.json'), JSON.stringify(row.result));
      writeFileSync(join(path, 'owned/supervisor.json'), JSON.stringify(row.supervisor));
    }
    const execution = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, N7_SOURCE: actualSource, RUNNER_TEMP: directory, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` },
    });
    assert.equal(execution.signal, null); assert.equal(execution.status, 1, execution.stdout + execution.stderr);
    const report = JSON.parse(readFileSync(join(output, 'aggregate.json'), 'utf8'));
    assert.equal(report.passed, false); assert.equal(report.fullBuild.p95, 30_000); assert.equal(report.fullBuild.values.length, 20);
    assert.match(readFileSync(join(output, 'aggregation.log'), 'utf8'), /N7 p95 threshold missed/);
    for (const row of rows) assert.deepEqual(JSON.parse(readFileSync(join(output, `n7-sample-${row.result.sample}/measurement/result.json`), 'utf8')), row.result);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('real log retention stays bounded after readiness and finalization refuses late faults', async () => {
  const { retainOutput, finalizeResult } = await import('./run.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'forma-n7-output-'));
  try {
    const path = join(directory, 'watch.log');
    const owned = { child: { pid: 123 }, label: 'watch', text: '', logBytes: 0, truncated: false, fault: null, closed: true, exit: { code: 0, signal: null } };
    retainOutput(owned, path, Buffer.from('READY\n'), 16);
    assert.match(owned.text, /READY/);
    const good = { failures: [], semanticChecksPassed: true };
    finalizeResult(good, [owned]); assert.equal(good.complete, true);
    retainOutput(owned, path, Buffer.from('abcdefghijklmnop'), 16);
    retainOutput(owned, path, Buffer.from('more output after the fault'), 16);
    assert.equal(readFileSync(path).length, 16); assert.equal(owned.text.length, 16);
    assert.equal(owned.truncated, true); assert.match(owned.fault.message, /truncated at 16 bytes/);
    const late = { failures: [], semanticChecksPassed: true };
    finalizeResult(late, [owned]); assert.equal(late.complete, false); assert.match(late.failures[0], /truncated/);
    owned.fault = new Error('late child failure');
    const childError = { failures: [], semanticChecksPassed: true };
    finalizeResult(childError, [owned]); assert.equal(childError.complete, false); assert.match(childError.failures[0], /late child failure/);
    for (const missing of ['Workspace 0', 'Closed', '<p class="notice">Pending review</p>']) {
      assert.throws(() => assertPage(html(REVISION).replace(missing, ''), 0, REVISION), /native typed/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('native typed text requires the real matched marker/key envelope and exact content', () => {
  const rendered = html(REVISION);
  assertPage(rendered, 0, REVISION);
  for (const [before, after] of [
    ['Workspace 0', 'Workspace 1'], ['Open', 'Different'], ['Closed', ''],
    ['data-forma-key="1"', 'data-forma-key="9"'], ['<!--/f:t0-->', '<!--/f:t9-->'],
  ]) assert.throws(() => assertPage(rendered.replace(before, after), 0, REVISION), /native typed/);
});


test('timed edit response retains its original body before enforcing the existing no-store condition', async () => {
  const { retainEditResponse } = await import('./run.mjs');
  const result = {};
  const good = { status: 200, headers: { 'cache-control': 'no-store' }, html: html(NEXT_REVISION) };
  assert.equal(retainEditResponse(result, good), good); assert.equal(result.lastEditResponse, good);
  const bad = { ...good, headers: { 'cache-control': 'public, max-age=300' } };
  assert.throws(() => retainEditResponse(result, bad), /no-store/);
  assert.equal(result.lastEditResponse, bad);
});


test('affected siblings may publish later, but share the original save deadline and preserve every refusal', async () => {
  let clock = 9000, calls = 0;
  const records = [];
  const body = (route, revision) => {
    const index = route === '/page/00' ? 0 : 11;
    return html(revision).replace('Workspace 0', `Workspace ${index}`) + expectedFor(index).map(name => `<div data-n7-component="${name}"></div>`).join('');
  };
  const read = async route => { clock += 100; return { status: 200, headers: { 'cache-control': 'no-store' }, html: body(route, route === '/page/11' && calls++ === 0 ? REVISION : NEXT_REVISION) }; };
  const result = await observeAffected({ started: 0, now: () => clock, read, delay: async () => { clock += 10; }, record: row => records.push(row) });
  assert.deepEqual(result, { firstObservedUpdatedMs: { '/page/00': 9100, '/page/11': 9310 }, maxMs: 9310 });
  assert.equal(records.length, 3); assert(records[1].html.includes(REVISION)); assert(records[2].html.includes(NEXT_REVISION));
  clock = 9900;
  await assert.rejects(observeAffected({ started: 0, now: () => clock, read: async route => { clock += 25; return { status: 200, headers: { 'cache-control': 'no-store' }, html: body(route, REVISION) }; }, delay: async () => { clock += 50; }, record() {} }), /deadline/);
  assert.equal(clock, 10000, 'the observation did not restart a fresh 10s clock');
  for (const bad of [
    { status: 500, headers: {}, html: 'actual failed response' },
    { status: 200, headers: { 'cache-control': 'public' }, html: body('/page/00', NEXT_REVISION) },
    { status: 200, headers: { 'cache-control': 'no-store' }, html: body('/page/00', NEXT_REVISION).replace('Workspace 0', 'Wrong content') },
  ]) {
    const retained = [];
    await assert.rejects(observeAffected({ started: 0, now: () => 1, read: async () => bad, delay: async () => assert.fail('wrong response cannot retry'), record: row => retained.push(row) }));
    assert.equal(retained.length, 1); assert.equal(retained[0].html, bad.html);
  }
  const errors = [];
  await assert.rejects(observeAffected({ started: 0, now: () => 2, read: async () => { throw new Error('watcher fault'); }, record: row => errors.push(row) }), /watcher fault/);
  assert.match(errors[0].error, /watcher fault/);
  const before = '<head>nonce-one</head><main data-n7-component="Page01"><p>Original content</p></main>';
  assertUnchangedPage(before, before.replace('nonce-one', 'nonce-two'), 1);
  assert.throws(() => assertUnchangedPage(before, before.replace('Original content', 'Unexpected change'), 1), /unaffected rendered/);
});
