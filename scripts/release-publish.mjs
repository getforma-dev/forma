#!/usr/bin/env node
// Runs only in the credential job, after artifact verification and P17. Standard library only;
// no install, build, dependency script, local action, cache, or dynamic shell evaluation.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CRATES, NPM, ROOT, json, digest, run, assertReleaseSet } from './release-set.mjs';

export function verifyIdentity(set, dir) {
  assert.equal(set.schema, 1);
  assert.equal(set.dryRun, false, 'dry-run artifacts never publish');
  assert.equal(set.commit, process.env.GITHUB_SHA, 'source commit differs from packed set');
  assert.equal(set.tag, process.env.GITHUB_REF_NAME, 'tag differs from packed set');
  assert.equal(String(set.run), process.env.GITHUB_RUN_ID, 'artifacts belong to another run');
  assert.equal(set.contracts.liveReleaseReady, true, 'milestone contract hooks are not ready');
  assertReleaseSet(set.packages, set.tag);
  assert.deepEqual(set.packages.filter(p => p.registry === 'crates').map(p => p.name), CRATES);
  assert.deepEqual(set.packages.filter(p => p.registry === 'npm').map(p => p.name), NPM.map(n => `@getforma/${n}`));
  for (const p of set.packages) {
    assert(/^[a-zA-Z0-9@+][a-zA-Z0-9._@+-]*$/.test(p.file), 'invalid artifact filename');
    assert.equal(digest(join(dir, p.file)), p.sha256, `${p.file} changed`);
  }
}
export async function registryStatus(p, dir, request = fetch, timeout = 20_000) {
  assert(timeout > 0, `${p.name}: registry verification deadline expired`);
  const url = p.registry === 'crates'
    ? `https://crates.io/api/v1/crates/${p.name}/${p.version}`
    : `https://registry.npmjs.org/${encodeURIComponent(p.name)}/${p.version}`;
  const response = await request(url, { headers: { 'User-Agent': 'getforma-release-ci' }, signal: AbortSignal.timeout(timeout) });
  if (response.status === 404) return 'missing';
  assert(response.ok, `${p.name}: registry status unreadable (${response.status}); refusing to publish`);
  const data = await response.json();
  if (p.registry === 'crates') {
    assert.equal(data.version?.checksum, p.sha256, `${p.name}@${p.version} already exists with different bytes`);
    assert.equal(data.version?.yanked, false, `${p.name}@${p.version} is yanked`);
  } else {
    assert.equal(data.dist?.integrity, `sha512-${digest(join(dir, p.file), 'sha512', 'base64')}`, `${p.name}@${p.version} already exists with different bytes`);
  }
  return 'present';
}
// The same deadline bounds each request and sleep; no extra request is allowed after it.
export async function waitForPackage(p, dir, milliseconds, { request = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + milliseconds;
  while (true) {
    const remaining = deadline - now();
    assert(remaining > 0, `${p.name}: uploaded version not verifiable before deadline`);
    if (await registryStatus(p, dir, request, Math.min(20_000, remaining)) === 'present') return;
    const rest = deadline - now();
    assert(rest > 0, `${p.name}: uploaded version not verifiable before deadline`);
    await sleep(Math.min(10_000, rest));
  }
}
export async function main() {
  const dir = resolve(process.argv[2] ?? '');
  const registry = process.argv[3];
  assert(['crates', 'npm'].includes(registry), 'publish registry must be crates or npm');
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REPOSITORY === 'getforma-dev/forma', 'publish only runs in the tag workflow');
  const set = json(join(dir, 'release-set.json'));
  verifyIdentity(set, dir);
  assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), set.commit, 'checkout differs from packed commit');
  assert.equal(run('git', ['diff', '--name-only', 'HEAD']).trim(), '', 'publish checkout must be clean');
  const pending = [];
  // Check every existing version before uploading any new one. A stale or contradictory
  // partial release cannot be resumed merely because a registry returns HTTP 200.
  for (const p of set.packages) {
    const status = await registryStatus(p, dir);
    console.log(`${p.name}@${p.version}: ${status}`);
    if (status === 'missing') pending.push(p);
  }
  if (registry === 'npm') assert(!pending.some(p => p.registry === 'crates'), 'npm must wait for every crate to be published and verified');
  // Cargo publishes source, not a supplied .crate. Repackage every crate using precisely the
  // same source, Cargo version and recorded workspace lock; compare bytes before first upload.
  if (registry === 'crates') {
    assert.equal(run('rustc', ['--version']).trim(), set.toolchain, 'repack toolchain changed');
    assert.equal(digest(join(ROOT, 'Cargo.lock')), digest(join(dir, 'Cargo.lock')), 'recorded Cargo.lock differs from tagged lock');
    run('cargo', ['package', '--workspace', '--no-verify', '--locked']);
    for (const p of set.packages.filter(p => p.registry === 'crates')) {
      assert.equal(digest(join(ROOT, 'target/package', p.file)), p.sha256, `${p.file}: repack differs from tested bytes`);
    }
  }
  const crates = registry === 'crates' ? pending.filter(p => p.registry === 'crates') : [];
  if (crates.length) run('cargo', ['publish', ...crates.flatMap(p => ['-p', p.name]), '--no-verify', '--locked'], ROOT, { stdio: 'inherit' });
  // Fixed deadline, hard failure if the newly uploaded bytes cannot be verified. The official
  // cargo workspace publisher already waits for dependency availability in topological order.
  const deadline = Date.now() + 15 * 60_000;
  for (const p of crates) await waitForPackage(p, dir, deadline - Date.now());
  for (const p of registry === 'npm' ? pending.filter(p => p.registry === 'npm') : []) {
    run('npm', ['publish', join(dir, p.file), '--ignore-scripts', '--provenance', '--access', 'public', '--tag', p.version.includes('-') ? 'next' : 'latest'], ROOT, { stdio: 'inherit' });
    await waitForPackage(p, dir, 5 * 60_000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(`release-publish: ${e.message}`); process.exitCode = 1; });
