// P17's measurement step (FORMA-188). It measures three things and records them, with the machine
// and profile they were taken on, in the report that DS12 embeds (release-record.mjs):
//
//   - P17's own wall time against G6's thirty minutes (FORMA-187's definition: the tag's push to the
//     GitHub Release written; P17 alone may not use more than the whole);
//   - Forma's code per fixture route, from the packed build's size report, against N2 as L-58
//     restated it (the packed build's own ceiling, gzip -9 per route), re-asserted beside the build's own BUILD-819;
//   - the shape of the consumer-shaped pages (the walker's node, byte and list counts, the islands),
//     recorded and not gated: FORMA-191 reads them and adds N1, N3 and N5 rows to the same report.
//
// Nothing here sets a threshold. Both figures are recorded decisions: G6 (appendix C) and L-58.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, totalmem } from 'node:os';

/** G6: tag push to the Release written, thirty minutes (FORMA-187). P17 is a part of that, so it may not exceed it alone. */
export const P17_BUDGET_SECONDS = 1800;
/** Read the file emitted by the packed build, including its route-specific ceilings and verdicts. */
export function readPackedSizes(outputDir) {
  const report = JSON.parse(readFileSync(join(outputDir, 'size-report.json'), 'utf8'));
  assert.equal(report.version, 1, 'N2: unsupported packed size-report.json version');
  for (const key of ['forma', 'page', 'canvas']) {
    assert(Number.isInteger(report.ceilings?.[key]) && report.ceilings[key] > 0, `N2: packed size-report.json has no ${key} ceiling`);
  }
  assert(Array.isArray(report.routes) && report.routes.length > 0, 'N2: packed size-report.json reported no route sizes');
  for (const route of report.routes) {
    assert(['no-interactive-region', 'islands', 'whole-page-mount'].includes(route.class), `N2 ${route.route}: packed size report has no route class`);
    assert.equal(typeof route.canvas, 'boolean', `N2 ${route.route}: packed size report has no canvas declaration`);
    const ceiling = route.class === 'no-interactive-region' ? 0 : report.ceilings.forma;
    assert.equal(route.ceilings?.forma, ceiling, `N2 ${route.route}: route ceiling differs from the packed policy`);
    const javascriptCeiling = route.class === 'no-interactive-region' ? 0 : report.ceilings[route.canvas ? 'canvas' : 'page'];
    assert.equal(route.ceilings?.javascript, javascriptCeiling, `N2 ${route.route}: JavaScript ceiling differs from the packed policy`);
  }
  return report.routes;
}

const fmt = n => n.toLocaleString('en-US');

/** What the figures were taken on: enough to read them later, nothing personal. */
export function machineProfile({ env = process.env, rustc = 'unknown', npm = 'unknown' } = {}) {
  const processors = cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel: processors[0]?.model ?? 'unknown',
    cpus: processors.length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    npm,
    rustc,
    runner: env.RUNNER_OS ? `${env.RUNNER_OS} ${env.RUNNER_ARCH ?? ''}`.trim() : 'local',
    profile: 'cargo debug binaries; npm packages from DS11; Chromium; P17 scratch install',
  };
}

/** One N2 row per route read from the packed build's size-report.json. */
export function n2Rows(app, sizes) {
  assert(Array.isArray(sizes) && sizes.length > 0, `${app}: the packed build reported no route sizes`);
  return sizes.map(size => {
    const limit = size.ceilings?.forma;
    assert(Number.isInteger(limit) && limit >= 0, `N2 ${app} ${size.route}: no Forma ceiling in the packed size report`);
    const javascriptLimit = size.ceilings?.javascript;
    assert(Number.isInteger(javascriptLimit) && javascriptLimit >= 0, `N2 ${app} ${size.route}: no JavaScript ceiling in the packed size report`);
    for (const [name, value] of [['forma.gzip', size.forma?.gzip], ['forma.brotli', size.forma?.brotli], ['gzip', size.gzip], ['javascript.gzip', size.javascript?.gzip]]) {
      assert(Number.isInteger(value) && value >= 0, `${app} ${size.route}: the size report has no ${name}`);
    }
    // The build's verdict includes the JavaScript ceiling too, not just Forma's share.
    const exceeded = [];
    if (size.forma.gzip > limit) exceeded.push('forma');
    if (size.javascript.gzip > javascriptLimit) exceeded.push('javascript');
    assert.deepEqual(size.exceeded, exceeded, `N2 ${app} ${size.route}: the packed build's exceeded verdict disagrees with its bytes and ceilings`);
    assert.equal(size.over, exceeded.length > 0, `N2 ${app} ${size.route}: the packed build's over verdict disagrees with its bytes and ceilings`);
    return {
      id: 'N2', app, route: size.route,
      formaGzip: size.forma.gzip, formaBrotli: size.forma.brotli,
      applicationGzip: size.application?.gzip ?? null, applicationBrotli: size.application?.brotli ?? null,
      routeGzip: size.gzip, routeBrotli: size.brotli,
      limit, passed: size.forma.gzip <= limit,
    };
  });
}

/** Fail naming the route and both numbers; every expected route must have a row (a missing figure is a failure). */
export function assertN2(rows, expected) {
  for (const { app, route } of expected) {
    assert(rows.some(row => row.app === app && row.route === route), `N2 ${app} ${route}: no figure was recorded for this fixture route`);
  }
  const over = rows.filter(row => row.formaGzip > row.limit);
  assert.deepEqual(over.map(row => `N2 ${row.app} ${row.route}: ${fmt(row.formaGzip)} B of Forma code over ${fmt(row.limit)} B gzip -9`), []);
  return rows;
}

/** The walker's counts from a fixture response's `x-fixture-counts` header, with the islands the page serves. */
export function shapeRow(app, route, header, islands) {
  const found = /^nodes=(\d+); bytes=(\d+); list=(\d+)$/.exec(header ?? '');
  assert(found, `shape ${app} ${route}: the server reported no walker counts (x-fixture-counts: ${header})`);
  return { id: 'shape', app, route, nodes: Number(found[1]), bytes: Number(found[2]), listIterations: Number(found[3]), islands };
}

export function p17Time(seconds, limit = P17_BUDGET_SECONDS) {
  assert(Number.isFinite(seconds) && seconds >= 0, 'P17 time: no elapsed seconds');
  return { id: 'P17-time', seconds, limitSeconds: limit, basis: 'G6: tag push to the GitHub Release written, 30 minutes (FORMA-187)', passed: seconds <= limit };
}

/** The whole step: assemble the record P17 saves, failing when any figure is missing or over. */
export function completeMeasurements({ machine, seconds, n2, shapes = [], expectedRoutes, performance, performanceContract }) {
  assert(machine?.node && machine?.platform && machine?.profile, 'measurements: the machine and profile block is missing');
  const time = p17Time(seconds);
  assert(time.passed, `P17-time ${fmt(Math.round(seconds))} s over ${fmt(time.limitSeconds)} s`);
  assertN2(n2, expectedRoutes);
  if (performanceContract) {
    assert.equal(performance?.contract, performanceContract, "SR2: performance record missing");
    assert.equal(performance.passed, true, "SR2: performance gate failed");
  }
  return { schema: 1, machine, p17: time, n2, shapes, ...(performance ? {performance} : {}) };
}

/** One line for the GitHub Release's notes. */
export function releaseNotesLine(measurements) {
  const { p17, n2, machine } = measurements;
  const worst = n2.reduce((a, b) => (b.formaGzip > a.formaGzip ? b : a));
  const performance = measurements.performance;
  const extra = performance ? ` N1 slowest p99: ${fmt(Math.floor(Math.min(...performance.n1.map(row=>row.p99NodesPerSecond))))} nodes/s; N5 median paired ratio ${performance.n5.medianTimeRatio.toFixed(2)}; mobile worst p95 TBT ${Math.max(...performance.mobile.map(row=>row.p95TbtMs)).toFixed(1)} ms. All three client comparison engines and both public budget refusals are recorded; ${performance.machine.profile}.` : "";
  return `P17 ran ${Math.round(p17.seconds)} s of ${fmt(p17.limitSeconds)} s; the most Forma code on any fixture route is ${fmt(worst.formaGzip)} B of ${fmt(worst.limit)} B gzip -9 (${worst.app} ${worst.route}); measured on ${machine.runner}, ${machine.cpus} CPUs, Node ${machine.node}.${extra}`;
}
