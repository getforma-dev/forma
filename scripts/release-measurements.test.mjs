import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './release-set.mjs';
import { N2_FORMA_GZIP_BYTES, P17_BUDGET_SECONDS, assertN2, completeMeasurements, machineProfile, n2Rows, p17Time, releaseNotesLine, shapeRow } from './release-measurements.mjs';

const size = (route, formaGzip, extra = {}) => ({ route, gzip: formaGzip + 600, brotli: formaGzip + 100, forma: { raw: 1, gzip: formaGzip, brotli: formaGzip - 2000 }, application: { raw: 1, gzip: 600, brotli: 500 }, over: false, ...extra });
const machine = machineProfile({ env: { RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' }, rustc: 'rustc 1.93.1', npm: '11.6.2' });

test('the two recorded figures are the figures the tree states', () => {
  // N2 (L-55) is enforced by the build as BUILD-819; the measurement must use the same number.
  const source = readFileSync(join(ROOT, 'packages/build/src/route-size.ts'), 'utf8');
  assert.equal(Number(/FORMA_CODE_CEILING_GZIP = ([\d_]+);/.exec(source)?.[1].replaceAll('_', '')), N2_FORMA_GZIP_BYTES);
  // G6 is printed into every Release's notes as the target.
  assert.match(readFileSync(join(ROOT, 'scripts/release-record.mjs'), 'utf8'), new RegExp(`target ${P17_BUDGET_SECONDS} seconds`));
});

test('N2: a route over the ceiling fails naming the app, the route and both numbers', () => {
  const rows = n2Rows('ledger', [size('/household', 25_366)]);
  assert.equal(rows[0].passed, true);
  assert.deepEqual(assertN2(rows, [{ app: 'ledger', route: '/household' }]), rows);
  const over = n2Rows('ledger', [size('/household', 25_731)]);
  assert.equal(over[0].passed, false);
  assert.throws(() => assertN2(over, [{ app: 'ledger', route: '/household' }]), /N2 ledger \/household: 25,731 B of Forma code over 25,500 B gzip -9/);
  // The boundary is inclusive, as the build's own gate is.
  assert.equal(n2Rows('a', [size('/', 25_500)])[0].passed, true);
  assert.equal(n2Rows('a', [size('/', 25_501)])[0].passed, false);
});

test('N2: a fixture route with no figure, or a size report without Forma bytes, fails', () => {
  const rows = n2Rows('ledger', [size('/household', 25_000)]);
  assert.throws(() => assertN2(rows, [{ app: 'ledger', route: '/household' }, { app: 'fauth', route: '/t/:slug/login' }]), /no figure was recorded for this fixture route/);
  assert.throws(() => n2Rows('ledger', []), /reported no route sizes/);
  assert.throws(() => n2Rows('ledger', [{ route: '/', gzip: 1, brotli: 1 }]), /no forma\.gzip/);
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
  assert.match(line, /25,424 B of 25,500 B gzip -9 \(fauth \/b\)/);
});
