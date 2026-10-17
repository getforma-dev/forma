import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from './verify-release-set.mjs';
import { ROOT } from './release-set.mjs';
import { pruneCargoLock } from './release-fixture-apps.mjs';
import { runInNewContext } from 'node:vm';
import { isExpectedReloadInterruption } from '../e2e/skew/run-drill.mjs';

test('the standalone deployment lock preserves pinned dependencies without unrelated workspace features', () => {
  const version = '9.9.9';
  const workspace = pruneCargoLock(readFileSync(join(ROOT, 'e2e/Cargo.lock'), 'utf8'), 'forma-e2e-skew', version);
  const standalone = pruneCargoLock(readFileSync(join(ROOT, 'e2e/skew/Cargo.release.lock'), 'utf8'), 'forma-e2e-skew', version);
  // The e2e workspace enables this optional edge elsewhere. Carrying it into
  // this standalone crate makes cargo --locked refuse before the drill runs.
  const expected = workspace.split(/(?=^\[\[package\]\]\n)/m)
    .filter(block => !/^name = "valuable"$/m.test(block))
    .map(block => /^name = "tracing-core"$/m.test(block) ? block.replace(' "valuable",\n', '') : block)
    .join('').trimEnd() + '\n';
  assert.notEqual(workspace, standalone, 'the standalone seed must not inherit workspace-only feature edges');
  assert.equal(standalone, expected, 'no third-party version, checksum or other dependency may drift');
  for (const name of ['forma-ir', 'forma-ir-derive', 'forma-server']) {
    assert(standalone.includes(`name = "${name}"\nversion = "${version}"`));
  }
});

test('P17 refuses unknown deployment contracts before inspecting packages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-skew-contract-'));
  try {
    const candidate = deploymentSkew => writeFileSync(join(dir, 'release-set.json'), JSON.stringify({
      contracts: { props: null, deploymentSkew },
      packages: [{ file: 'unpacked-sentinel.tgz', sha256: '0'.repeat(64) }],
    }));
    for (const contract of ['native-v2', '', false, 0, {}]) {
      candidate(contract);
      await assert.rejects(verify(dir, join(dir, 'report.json')), /P17 has no verifier for the recorded deployment skew contract/);
    }
    // The supported and historical contracts reach package verification. This
    // sentinel prevents any unpack/build/browser work while proving admission.
    for (const contract of [undefined, null, 'native-v1']) {
      candidate(contract);
      await assert.rejects(verify(dir, join(dir, 'report.json')), error =>
        error.code === 'ENOENT' && error.path === join(dir, 'unpacked-sentinel.tgz'));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the actual final packed call sequence finishes skew before a mandatory performance refusal', async () => {
  // Exercise the unchanged production call block with owned helpers substituted,
  // without running a packed build or a performance measurement in this suite.
  const source = verify.toString();
  const start = source.indexOf('// The fixture applications (FORMA-188):');
  const end = source.indexOf('} finally { await browser.close(); }', start);
  assert(start >= 0 && end > start, 'the complete final packed call block must be present');
  const block = source.slice(start, end);
  const calls = [], report = { passed: false }, refusal = new Error('decoder: observed sample exceeds 12 ms');
  const context = {
    set: { contracts: { deploymentSkew: 'native-v1', fixtureApps: 'declared-v1' } }, report,
    dir: '/packed', scratch: '/scratch', browser: {}, firefox: {}, webkit: {}, test: () => {},
    measurementTarget: { tag: 'v3.0.0-beta.1', rehearsal: true }, started: 0, reportPath: '/evidence/p17.json',
    join, resolve: value => value, dirname: () => '/evidence',
    verifyPackedSkew: async () => { calls.push('skew'); return { checked: true }; },
    verifyPackedFixtures: async args => { calls.push('fixtures/performance'); assert.equal(args.performanceTarget, context.measurementTarget); throw refusal; },
  };
  await assert.rejects(runInNewContext(`(async () => { ${block} })()`, context), error => error === refusal);
  assert.deepEqual(calls, ['skew', 'fixtures/performance']);
  assert.deepEqual(report.deploymentSkew, { checked: true });
  assert.equal(report.passed, false);
  assert.equal(report.fixtures, undefined, 'a failed mandatory measurement cannot manufacture a successful fixture report');
});


test('only the observed same-target intentional reload interruption reaches the unchanged drill oracle', () => {
  const actual = JSON.parse(readFileSync(join(ROOT, 'docs/archive/skew-expected-reload/actual-skew-diagnostics.json'), 'utf8'));
  const page = actual.pages.at(-1), event = JSON.parse(page.events[0]);
  const log = readFileSync(join(ROOT, 'docs/archive/skew-expected-reload/first-packed-verify.log'), 'utf8');
  const line = log.split('\n').find(line => line.startsWith('P17: page.goto: Navigation to '));
  assert(line, 'the actual packed failure must supply the original interruption message');
  const error = new Error(line.slice('P17: '.length));
  const input = { mode: 'normal', reload: true, target: page.url, event, bundle: event.bundle };
  assert.equal(isExpectedReloadInterruption(error, input), true);
  for (const change of [
    { mode: 'blocked' }, { mode: 'cancel' }, { reload: false },
    { target: page.url + '/other' }, { target: page.url.replace('127.0.0.1', 'localhost') },
    { event: undefined }, { event: { ...event, page: 'other' } },
    { event: { ...event, bundle: 'different' } }, { event: { ...event, reload: false } },
    { bundle: 'different' }, { bundle: undefined, event: { ...event, bundle: undefined } },
  ]) assert.equal(isExpectedReloadInterruption(error, { ...input, ...change }), false, JSON.stringify(change));
  for (const message of [
    'page.goto: Timeout 10000ms exceeded.',
    'page.goto: net::ERR_CONNECTION_REFUSED',
    error.message.replace(`another navigation to "${page.url}"`, `another navigation to "${page.url}/other"`),
    error.message.replace(`Navigation to "${page.url}"`, `Navigation to "${page.url}/other"`),
  ]) assert.equal(isExpectedReloadInterruption(new Error(message), input), false, message);
  assert.equal(isExpectedReloadInterruption(Object.assign(new Error(error.message), { name: 'TimeoutError' }), input), false);
});
