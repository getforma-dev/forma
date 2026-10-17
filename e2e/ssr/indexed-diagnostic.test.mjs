// NEVER MERGE: finite proof for the disclosed diagnostic adaptation only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { measureIndexedPublicSet } from './indexed-timing.ts';
import { measureIndexedDiagnostic } from './indexed-diagnostic.ts';
import { completeDiagnosticTrace, readDiagnosticBrowserMetadata } from './indexed-diagnostic-trace.mjs';

const normalize = value => JSON.parse(JSON.stringify(value));
async function collect(fn, arm, { markCost = 0, refuse = false } = {}) {
  let elapsed = 0, pendingPause = false, fault = false;
  const counts = { small: 0, large: 0 }, current = {}, progress = [], marks = [], pauses = [];
  const handles = Object.fromEntries(['small', 'large'].map(name => [name, { set(key, value) {
    assert.equal(pendingPause, false);
    if (fault) throw new Error('real synthetic public-set refusal');
    assert.equal(key, 'row-0'); assert.equal(value.id, 'row-0');
    counts[name]++;
    elapsed += current[name] === value ? 1 / 1024 : 1 / 32;
    current[name] = value;
  } }]));
  const context = {
    window: { __indexed: handles }, navigator: { userAgent: 'finite diagnostic control' },
    console: { debug(text) {
      const row = JSON.parse(text.slice('[forma:indexed-progress] '.length));
      progress.push({ row, counts: { ...counts } });
      if (refuse && row.phase === 'paired-row' && row.round === 1) fault = true;
    } },
    performance: {
      now() { assert.equal(pendingPause, false); elapsed += 1 / 64; return Math.floor(elapsed * 8) / 8; },
      mark(label) { marks.push({ label, counts: { ...counts } }); elapsed += markCost; },
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 0); assert.equal(pendingPause, false); pendingPause = true;
      pauses.push({ ...counts });
      queueMicrotask(() => { pendingPause = false; callback(); });
    },
    document: { querySelectorAll(selector) {
      if (selector === '#small li') return Array(200);
      if (selector === '#large li') return Array(2000);
      assert.equal(selector, '#small li:first-child b, #large li:first-child b');
      return ['small', 'large'].map(name => ({ textContent: current[name]?.label }));
    } },
  };
  let report, error;
  try { report = normalize(await runInNewContext(`(${fn.toString()})(${JSON.stringify(arm)})`, context)); }
  catch (caught) { error = caught; }
  return { report, error, counts, progress: normalize(progress), marks, pauses };
}

test('removing only alias setup and out-of-interval marks recovers exact parent collector source', () => {
  const original = readFileSync(new URL('./indexed-timing.ts', import.meta.url), 'utf8');
  const restored = readFileSync(new URL('./indexed-diagnostic.ts', import.meta.url), 'utf8')
    .replace('// NEVER MERGE: diagnostic adaptation; finite control reverses every disclosed change.\n', '')
    .replace("export async function measureIndexedDiagnostic(arm: 'small-large' | 'small-small' | 'large-large') {", 'export async function measureIndexedPublicSet() {')
    .replace('const handles = { ...(window as any).__indexed };', 'const handles = (window as any).__indexed;')
    .replace(/  \/\/ DIAGNOSTIC ALIAS BEGIN:[\s\S]*?  \/\/ DIAGNOSTIC ALIAS END\n/, '')
    .replace(/^.*\/\/ DIAGNOSTIC MARK\n/gm, '');
  assert.equal(restored, original);
});

test('original-pair work/count/order/endpoints remain exact even with 1024ms marker overhead', async () => {
  const original = await collect(measureIndexedPublicSet, 'small-large');
  const diagnostic = await collect(measureIndexedDiagnostic, 'small-large', { markCost: 1024 });
  assert.ifError(original.error); assert.ifError(diagnostic.error);
  assert.deepEqual(diagnostic.report, original.report);
  assert.deepEqual(diagnostic.counts, original.counts);
  assert.deepEqual(diagnostic.pauses, original.pauses); assert.equal(diagnostic.pauses.length, 202);
  assert.deepEqual(diagnostic.progress.filter(v => v.row.phase !== 'diagnostic-alias'), original.progress);
  const marks = diagnostic.marks;
  assert.equal(marks.length, diagnostic.report.clock.calibration.length * 4 + 101 * 12);
  for (let i = 0; i < marks.length; i += 2) {
    const begin = marks[i], end = marks[i + 1], pieces = begin.label.split(':');
    assert.equal(end.label, begin.label.replace(/:begin$/, ':end'));
    const owner = pieces.at(-2), phase = pieces[3];
    const count = phase === 'single' ? 1 : phase === 'calibration' ? Number(pieces[4]) : diagnostic.report.batch;
    assert.equal(end.counts[owner] - begin.counts[owner], count);
    assert.equal(end.counts[owner === 'small' ? 'large' : 'small'], begin.counts[owner === 'small' ? 'large' : 'small']);
  }
});

for (const owner of ['small', 'large']) test(`${owner}/${owner} aliases only after both physical warmups and keeps every measured operation`, async () => {
  const result = await collect(measureIndexedDiagnostic, `${owner}-${owner}`, { markCost: 1024 });
  assert.ifError(result.error);
  const r = result.report, other = owner === 'small' ? 'large' : 'small';
  const alias = result.progress.find(v => v.row.phase === 'diagnostic-alias');
  assert.deepEqual(alias, { row: { phase: 'diagnostic-alias', arm: `${owner}-${owner}`, sameOwner: true }, counts: { small: 5000, large: 5000 } });
  assert.equal(result.counts[other], 5000);
  assert.equal(result.counts[owner], 5000 + 2 * r.clock.calibration.reduce((n, row) => n + row.batch, 0) + 202 * (2 * r.batch + 2));
  assert.equal(r.rounds, 101); assert.equal(result.pauses.length, 202);
  for (const slot of ['small', 'large']) {
    assert.equal(r.samples[slot].length, 101); assert.equal(r.noOp[slot].length, 101);
    assert(r.samples[slot].every(value => value > .03), 'aliased edit batch accidentally became identity no-ops');
    assert(r.noOp[slot].every(value => value < .002));
  }
  assert.deepEqual(r.rows, [200, 2000]); assert.deepEqual(r.labels, ['Timing B', 'Timing B']);
  assert.equal(result.progress.at(-1).row.phase, 'complete');
});

test('invalid arms and public-operation refusal remain failures with partial observations intact', async () => {
  const invalid = await collect(measureIndexedDiagnostic, 'extra-arm');
  assert.match(String(invalid.error), /invalid diagnostic arm/); assert.equal(invalid.report, undefined);
  const failed = await collect(measureIndexedDiagnostic, 'small-small', { refuse: true });
  assert.match(String(failed.error), /public-set refusal/); assert.equal(failed.report, undefined);
  assert.equal(failed.progress.filter(v => v.row.phase === 'paired-row').length, 2);
  assert(!failed.progress.some(v => v.row.phase === 'complete'));
});

test('temporary donor/config retain exactly three ordered arms, original source, no retry, bounded ownership and always evidence', () => {
  const spec = readFileSync(new URL('./indexed-diagnostic.spec.ts', import.meta.url), 'utf8');
  const config = readFileSync(new URL('./indexed-diagnostic.config.ts', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert(spec.includes("const arms = ['small-large', 'small-small', 'large-large'] as const;"));
  assert(spec.includes('for (const arm of arms) test('));
  assert(spec.includes("save('indexed-public-set.json', report); // Original complete rows before any check."));
  assert(spec.includes("state: 'started'")); assert(spec.includes("'incomplete-or-invalid'"));
  assert(spec.includes("assert.deepEqual(observed.errors, []); assert.deepEqual(observed.policy, []);"));
  assert(spec.includes("await session.send('Tracing.end')")); assert(spec.includes("await session.send('IO.close'"));
  assert(config.includes('workers: 1, fullyParallel: false')); assert(config.includes('globalTimeout: 540_000, retries: 0'));
  assert(config.includes('reuseExistingServer: false'));
  assert(workflow.includes('workflow_dispatch:')); assert(!workflow.includes('pull_request:'));
  assert(workflow.includes('test "$GITHUB_RUN_ATTEMPT" = 1'));
  assert(workflow.includes('git merge-base --is-ancestor 93d3d9370b2b67ceed21c8f80d41566dbe6dca86 HEAD'));
  assert(workflow.includes('scripts/release-owned-linux.py "$RUNNER_TEMP/indexed-null-owned" 570 --'));
  assert(workflow.includes('if: always()')); assert(!workflow.includes('contents: write'));
});


test('actual post-EOF finalization refuses known loss and absent/nonboolean loss status', () => {
  const complete = { dataLossOccurred: false, stream: 'actual-stream', traceFormat: 'json' };
  assert.deepEqual(completeDiagnosticTrace(complete, 1234), { complete: true, bytes: 1234, dataLossOccurred: false });
  for (const payload of [{ ...complete, dataLossOccurred: true }, { stream: 'actual-stream' },
    { ...complete, dataLossOccurred: 'false' }, { ...complete, dataLossOccurred: 0 }, undefined]) {
    assert.throws(() => completeDiagnosticTrace(payload, 1234), /trace data loss must be explicitly false/);
  }
  assert.deepEqual(complete, { dataLossOccurred: false, stream: 'actual-stream', traceFormat: 'json' });
});


test('metadata tolerates the actual pinned default by never requesting the unsupported command-line API', async () => {
  const calls = [], session = { async send(method) {
    calls.push(method);
    if (method === 'Browser.getVersion') return { product: 'original pinned Chromium' };
    if (method === 'Tracing.getCategories') return { categories: ['blink.user_timing'] };
    throw new Error('Command line not returned because --enable-automation not set.');
  } };
  assert.deepEqual(await readDiagnosticBrowserMetadata(session), {
    version: { product: 'original pinned Chromium' },
    commandLine: { availableViaCdp: false, source: 'owned worker.log DEBUG=pw:browser launch records' },
    traceCategories: { categories: ['blink.user_timing'] },
  });
  assert.deepEqual(calls, ['Browser.getVersion', 'Tracing.getCategories']);
  await assert.rejects(readDiagnosticBrowserMetadata({ send: async () => { throw new Error('unexpected CDP failure'); } }), /unexpected CDP failure/);
});

test('actual config body places every arm and JSON inventory in the uploaded repository root', () => {
  const file = new URL('./indexed-diagnostic.config.ts', import.meta.url), directory = dirname(fileURLToPath(file));
  const body = readFileSync(file, 'utf8').replace(/^import .*\n/gm, '').replace('export default defineConfig(', 'globalThis.loaded = defineConfig(');
  const context = { __dirname: directory, join, resolve, defineConfig: value => value, SSR_ORIGIN: 'http://127.0.0.1:3458', SSR_PORT: 3458 };
  runInNewContext(body, context);
  const root = resolve(directory, '../../test-results/indexed-null');
  assert.equal(context.loaded.outputDir, join(root, 'arms'));
  assert.equal(context.loaded.reporter[1][1].outputFile, join(root, 'playwright.json'));
  assert.equal(context.loaded.use.launchOptions, undefined, 'no launch flag changes');
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert(workflow.includes('fetch-depth: 4'));
  assert(workflow.includes('DEBUG=pw:browser python3 scripts/release-owned-linux.py'));
  assert(workflow.includes('            test-results/indexed-null/'));
});
