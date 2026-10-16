import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, digest, run } from './release-set.mjs';
import { fixtureCargoToml, pruneCargoLock } from './release-fixture-apps.mjs';
import { buildSkewApps } from '../e2e/skew/build-app.mjs';
import { runSkewDrill, SKEW_DRILL_CHECKS } from '../e2e/skew/run-drill.mjs';

export function requireSkewChecks(report) {
  assert.deepEqual(report.checks, SKEW_DRILL_CHECKS, 'the deployment drill must execute every named check');
  for (const name of ['A', 'B', 'B2', 'C', 'S']) assert.match(report.builds[name], /^[0-9a-f]{16}$/);
  assert.equal(report.builds.B, report.builds.B2);
  assert.ok(report.requests.some(row => row.instance === 'B' && row.status === 200 && /immutable/.test(row.cacheControl)), 'no retained HTTP observation');
  assert.ok(report.requests.some(row => row.instance === 'S' && row.status === 404), 'no revoked HTTP observation');
  return report;
}

/** Package code comes only from the unpacked set; source probes come from its tagged commit. */
export async function verifyPackedSkew({ set, scratch, browser, firefox, webkit, test }) {
  const root = join(scratch, 'skew-drill'), server = join(root, 'server');
  mkdirSync(join(server, 'src'), { recursive: true });
  const sources = ['build-app.mjs', 'balancer.mjs', 'run-drill.mjs', 'server/Cargo.toml', 'server/src/main.rs', 'Cargo.release.lock'];
  const sourceHashes = {};
  for (const file of sources) {
    const path = `e2e/skew/${file}`, original = readFileSync(join(ROOT, path));
    assert.deepEqual(original, run('git', ['show', `${set.commit}:${path}`], ROOT, { encoding: 'buffer' }), `skew source differs from ${set.commit}: ${file}`);
    sourceHashes[file] = digest(join(ROOT, path));
  }
  const packedBuild = join(scratch, 'packages/build/dist/index.js');
  const { build } = await import(pathToFileURL(packedBuild).href);
  let deployments;
  await test('deployment drill: five distributions built by the packed build, with identical B2 and no security retention', async () => {
    deployments = await buildSkewApps({ build, coreDir: join(scratch, 'packages/core'), outputDir: join(root, 'out') });
  });
  copyFileSync(join(ROOT, 'e2e/skew/server/src/main.rs'), join(server, 'src/main.rs'));
  const version = set.packages[0].version;
  writeFileSync(join(server, 'Cargo.toml'), fixtureCargoToml(readFileSync(join(ROOT, 'e2e/skew/server/Cargo.toml'), 'utf8'), version, join(scratch, 'crates')));
  writeFileSync(join(server, 'Cargo.lock'), pruneCargoLock(readFileSync(join(ROOT, 'e2e/skew/Cargo.release.lock'), 'utf8'), 'forma-e2e-skew', version));
  const target = join(scratch, 'target');
  await test('deployment drill: actual embedded native servers built locked from the packed crates', async () => {
    run('cargo', ['build', '--locked'], server, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: '0' } });
  });
  const binary = join(target, 'debug', process.platform === 'win32' ? 'forma-e2e-skew.exe' : 'forma-e2e-skew');
  const result = { sourceHashes, cargoLockSha256: digest(join(server, 'Cargo.lock')), engines: {} };
  for (const [engine, launcher] of [['chromium', null], ['firefox', firefox], ['webkit', webkit]]) {
    const actual = launcher ? await launcher.launch() : browser;
    try {
      await test(`deployment drill: ${engine} packed rolling deployment, rollback and inert-or-reload`, async () => {
        result.engines[engine] = requireSkewChecks(await runSkewDrill({ browser: actual, binary, cwd: server, deployments }));
      });
    } finally { if (launcher) await actual.close(); }
  }
  return result;
}
