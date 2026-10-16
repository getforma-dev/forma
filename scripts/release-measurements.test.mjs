import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './release-set.mjs';
import { P17_BUDGET_SECONDS, readPackedSizes, assertN2, completeMeasurements, machineProfile, n2Rows, p17Time, releaseNotesLine, shapeRow } from './release-measurements.mjs';

const size = (route, formaGzip, extra = {}) => ({
  route, class: 'islands', canvas: false,
  gzip: formaGzip + 600, brotli: formaGzip + 100,
  forma: { raw: 1, gzip: formaGzip, brotli: Math.max(0, formaGzip - 2000) },
  application: { raw: 1, gzip: 600, brotli: 500 },
  javascript: { raw: 1, gzip: formaGzip + 900, brotli: formaGzip + 200 },
  ceilings: { forma: 27_500, javascript: 75 * 1024 }, exceeded: [], over: false,
  ...extra,
});
const machine = machineProfile({ env: { RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' }, rustc: 'rustc 1.93.1', npm: '11.6.2' });

test('N2 reads the emitted JSON policy and each route ceiling without reading bundle source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-ceiling-'));
  try {
    const report = { version: 1, ceilings: { forma: 27_500, page: 75 * 1024, canvas: 365 * 1024 }, routes: [size('/', 27_000)] };
    const save = () => writeFileSync(join(dir, 'size-report.json'), JSON.stringify(report));
    save();
    assert.deepEqual(readPackedSizes(dir), report.routes);
    writeFileSync(join(dir, 'index.js'), 'var FORMA_CODE_CEILING_GZIP = 1;');
    assert.equal(readPackedSizes(dir)[0].ceilings.forma, 27_500, 'the emitted report is authoritative, not bundled code spelling');
    report.ceilings.forma = 29_000;
    report.routes[0].ceilings.forma = 29_000;
    save();
    assert.equal(n2Rows('a', readPackedSizes(dir))[0].limit, 29_000, 'a changed policy needs no measurement-script constant');
    report.routes[0].ceilings.forma = 27_500;
    save();
    assert.throws(() => readPackedSizes(dir), /route ceiling differs/);
    report.routes[0].ceilings.forma = 29_000;
    report.routes[0].ceilings.javascript = 1;
    save();
    assert.throws(() => readPackedSizes(dir), /JavaScript ceiling differs/);
    report.routes[0].ceilings.javascript = 365 * 1024;
    report.routes[0].canvas = true;
    save();
    assert.equal(readPackedSizes(dir)[0].ceilings.javascript, 365 * 1024);
    report.routes[0].class = 'no-interactive-region';
    report.routes[0].ceilings = { forma: 0, javascript: 0 };
    save();
    assert.equal(readPackedSizes(dir)[0].ceilings.forma, 0);
    delete report.routes[0].class;
    save();
    assert.throws(() => readPackedSizes(dir), /no route class/);
    report.version = 2;
    save();
    assert.throws(() => readPackedSizes(dir), /unsupported/);
    rmSync(join(dir, 'size-report.json'));
    assert.throws(() => readPackedSizes(dir), /ENOENT/, 'bundle source is never a fallback');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(readFileSync(join(ROOT, 'scripts/release-record.mjs'), 'utf8'), new RegExp(`target ${P17_BUDGET_SECONDS} seconds`));
});

test('N2 requires both route verdicts, and checks JavaScript excess separately from Forma code', () => {
  for (const field of ['over', 'exceeded']) {
    const row = size('/', 27_000);
    delete row[field];
    assert.throws(() => n2Rows('a', [row]), /verdict disagrees/);
  }
  assert.throws(() => n2Rows('a', [size('/', 27_000, { over: true })]), /over verdict disagrees/);
  assert.throws(() => n2Rows('a', [size('/', 27_000, { exceeded: ['forma'], over: true })]), /exceeded verdict disagrees/);
  const jsOver = size('/', 27_000, { javascript: { gzip: 80_000 }, exceeded: ['javascript'], over: true });
  assert.equal(n2Rows('a', [jsOver])[0].passed, true, 'the build refuses total JavaScript, while N2 names Forma code');
  assert.throws(() => n2Rows('a', [{ ...jsOver, exceeded: [], over: false }]), /exceeded verdict disagrees/);
});

test('N2: a route over the report ceiling fails naming the app, the route and both numbers', () => {
  const rows = n2Rows('ledger', [size('/household', 27_366)]);
  assert.equal(rows[0].passed, true);
  assert.deepEqual(assertN2(rows, [{ app: 'ledger', route: '/household' }]), rows);
  const over = n2Rows('ledger', [size('/household', 27_731, { exceeded: ['forma'], over: true })]);
  assert.equal(over[0].passed, false);
  assert.throws(() => assertN2(over, [{ app: 'ledger', route: '/household' }]), /N2 ledger \/household: 27,731 B of Forma code over 27,500 B gzip -9/);
  assert.equal(n2Rows('a', [size('/', 27_500)])[0].passed, true);
  assert.equal(n2Rows('a', [size('/', 27_501, { exceeded: ['forma'], over: true })])[0].passed, false);
  const staticRoute = size('/', 0, { class: 'no-interactive-region', javascript: { gzip: 0 }, ceilings: { forma: 0, javascript: 0 } });
  assert.equal(n2Rows('a', [staticRoute])[0].passed, true);
});

test('N2: missing routes, ceilings, or bytes fail instead of substituting a default', () => {
  const rows = n2Rows('ledger', [size('/household', 25_000)]);
  assert.throws(() => assertN2(rows, [{ app: 'ledger', route: '/household' }, { app: 'fauth', route: '/t/:slug/login' }]), /no figure was recorded for this fixture route/);
  assert.throws(() => n2Rows('ledger', []), /reported no route sizes/);
  assert.throws(() => n2Rows('ledger', [size('/', 1, { ceilings: undefined })]), /no Forma ceiling/);
  assert.throws(() => n2Rows('ledger', [size('/', 1, { ceilings: { forma: 27_500 } })]), /no JavaScript ceiling/);
  assert.throws(() => n2Rows('ledger', [size('/', 1, { forma: undefined })]), /no forma\.gzip/);
  assert.throws(() => n2Rows('ledger', [size('/', 1, { javascript: undefined })]), /no javascript\.gzip/);
});

test('P17 time: inside thirty minutes passes, one second over fails with both numbers', () => {
  assert.equal(p17Time(205).passed, true);
  assert.equal(p17Time(P17_BUDGET_SECONDS).passed, true);
  const rows = n2Rows('ledger', [size('/household', 25_000)]);
  const base = { machine, n2: rows, expectedRoutes: [{ app: 'ledger', route: '/household' }] };
  assert.equal(completeMeasurements({ ...base, seconds: 205 }).p17.passed, true);
  assert.throws(() => completeMeasurements({ ...base, seconds: P17_BUDGET_SECONDS + 1 }), /P17-time 1,801 s over 1,800 s/);
  assert.throws(() => completeMeasurements({ ...base, machine: undefined, seconds: 5 }), /machine and profile block is missing/);
  assert.throws(() => completeMeasurements({ ...base, seconds: Number.NaN }), /no elapsed seconds/);
});

test('shape rows come from the walker\'s own counts and refuse a missing header', () => {
  assert.deepEqual(shapeRow('bench', '/pages/300', 'nodes=298; bytes=9139; list=63', 2), { id: 'shape', app: 'bench', route: '/pages/300', nodes: 298, bytes: 9139, listIterations: 63, islands: 2 });
  for (const bad of [null, '', 'nodes=1', 'nodes=a; bytes=1; list=1']) assert.throws(() => shapeRow('bench', '/pages/300', bad, 2), /reported no walker counts/);
});

test('the machine block names the platform, the processors and the profile, and the notes line reads the worst route', () => {
  assert.equal(machine.runner, 'Linux X64');
  assert(machine.cpus >= 1 && machine.node.startsWith('v') && machine.profile.includes('debug'));
  assert.equal(machineProfile({ env: {} }).runner, 'local');
  const rows = n2Rows('fauth', [size('/a', 25_100), size('/b', 25_424)]);
  const line = releaseNotesLine(completeMeasurements({ machine, seconds: 301.4, n2: rows, expectedRoutes: [{ app: 'fauth', route: '/a' }, { app: 'fauth', route: '/b' }] }));
  assert.match(line, /P17 ran 301 s of 1,800 s/);
  assert.match(line, /25,424 B of 27,500 B gzip -9 \(fauth \/b\)/);
});

// Preserve historical synthetic policies above; current L-59 is read from the
// emitted report too, including its exact admitted and refused boundaries.
test('L-59 report admits 28000 bytes and refuses 28001 without a reader constant', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-l59-'));
  try {
    const ceilings = { forma: 28_000, javascript: 75 * 1024 };
    const report = { version: 1, ceilings: { forma: 28_000, page: 75 * 1024, canvas: 365 * 1024 }, routes: [size('/', 28_000, { ceilings })] };
    const save = () => writeFileSync(join(dir, 'size-report.json'), JSON.stringify(report));
    save();
    const admitted = n2Rows('indexed', readPackedSizes(dir));
    assert.equal(admitted[0].limit, 28_000);
    assert.equal(admitted[0].passed, true);
    assertN2(admitted, [{ app: 'indexed', route: '/' }]);
    report.routes = [size('/', 28_001, { ceilings, exceeded: ['forma'], over: true })];
    save();
    const refused = n2Rows('indexed', readPackedSizes(dir));
    assert.equal(refused[0].passed, false);
    assert.throws(() => assertN2(refused, [{ app: 'indexed', route: '/' }]), /28,001 B of Forma code over 28,000 B/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
