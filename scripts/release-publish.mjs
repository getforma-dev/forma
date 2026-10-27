#!/usr/bin/env node
// Runs only in the credential job, after artifact verification and P17. Standard library only;
// no install, build, dependency script, local action, cache, or dynamic shell evaluation.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CRATES, NPM, ROOT, SEMVER, json, digest, run, assertReleaseSet, assertMilestoneReady } from './release-set.mjs';

export function verifyIdentity(set, dir) {
  assert.equal(set.schema, 1);
  assert.equal(set.dryRun, false, 'dry-run artifacts never publish');
  assert.equal(set.commit, process.env.GITHUB_SHA, 'source commit differs from packed set');
  assert.equal(set.tag, process.env.GITHUB_REF_NAME, 'tag differs from packed set');
  assert.equal(String(set.run), process.env.GITHUB_RUN_ID, 'artifacts belong to another run');
  const version = assertReleaseSet(set.packages, set.tag);
  // The milestone is resolved again here from the contract the pack job recorded, so a
  // packed set cannot carry a readiness claim its own contract does not support.
  const milestone = assertMilestoneReady(set.contracts, version);
  assert.equal(set.milestone?.name, milestone.name, 'packed set names another milestone');
  assert.equal(set.milestone?.ready, true, 'packed set was not ready for its milestone');
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
// npm 11 refuses a prerelease on latest: -alpha.N, -beta.N and -rc.N go to next, finals to
// latest. Cargo takes the pre-release version itself; no tag is involved there.
export function npmPublishArgs(p, file) {
  assert(SEMVER.test(p.version) && !p.version.endsWith('-dev'), `${p.name}@${p.version}: not a publishable version`);
  return ['publish', file, '--ignore-scripts', '--provenance', '--access', 'public', '--tag', p.version.includes('-') ? 'next' : 'latest'];
}
export function cargoPublishArgs(crates) {
  for (const p of crates) assert(SEMVER.test(p.version) && !p.version.endsWith('-dev'), `${p.name}@${p.version}: not a publishable version`);
  return ['publish', ...crates.flatMap(p => ['-p', p.name]), '--no-verify', '--locked'];
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
// One-time first-package enrollment. This does not replace any publication gate.
const BOOTSTRAP_PACKAGE = '@getforma/router', BOOTSTRAP_VERSION = '3.2.0-rc.1';
export function cleanPublishEnvironment(environment) {
  const { NPM_ROUTER_BOOTSTRAP_TOKEN, NODE_AUTH_TOKEN, ...clean } = environment;
  return clean;
}
export async function routerBootstrapToken(set, pending, environment, request = fetch) {
  const token = environment.NPM_ROUTER_BOOTSTRAP_TOKEN;
  if (!token) return undefined;
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'router bootstrap requires GitHub Actions');
  assert.equal(environment.GITHUB_EVENT_NAME, 'push', 'router bootstrap requires tag push');
  assert.equal(environment.GITHUB_REPOSITORY, 'getforma-dev/forma', 'router bootstrap repository differs');
  assert.equal(environment.GITHUB_REF_NAME, `v${BOOTSTRAP_VERSION}`, 'router bootstrap is only for v3.2.0-rc.1');
  assert.equal(set.tag, environment.GITHUB_REF_NAME, 'router bootstrap set tag differs');
  assert.equal(set.commit, environment.GITHUB_SHA, 'router bootstrap source differs');
  assert.equal(String(set.run), environment.GITHUB_RUN_ID, 'router bootstrap run differs');
  assert.equal(set.dryRun, false, 'router bootstrap cannot use a dry-run set');
  const router = set.packages.find(p => p.registry === 'npm' && p.name === BOOTSTRAP_PACKAGE);
  assert(router?.version === BOOTSTRAP_VERSION, 'router bootstrap package/version differs');
  // The already-present path has passed registryStatus's exact archive check.
  if (!pending.some(p => p.registry === 'npm' && p.name === BOOTSTRAP_PACKAGE)) return undefined;
  const response = await request(`https://registry.npmjs.org/${encodeURIComponent(BOOTSTRAP_PACKAGE)}`, {
    headers: { 'User-Agent': 'getforma-release-ci' }, signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 404, 'router bootstrap requires an absent package, not a missing version');
  return token;
}
export function publishNpmPackage(p, file, environment, bootstrapToken, publish = run) {
  const env = cleanPublishEnvironment(environment);
  if (!bootstrapToken || p.name !== BOOTSTRAP_PACKAGE) return publish('npm', npmPublishArgs(p, file), ROOT, { stdio: 'inherit', env });
  assert.equal(p.registry, 'npm', 'router bootstrap registry differs');
  assert.equal(p.version, BOOTSTRAP_VERSION, 'router bootstrap version differs');
  // The auth file contains a reference, never the credential. Only this one
  // child receives it. All other npm packages keep their existing OIDC path.
  const directory = mkdtempSync(join(tmpdir(), 'forma-router-bootstrap-'));
  try {
    const config = join(directory, 'npmrc');
    writeFileSync(config, '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nregistry=https://registry.npmjs.org/\n', { mode: 0o600, flag: 'wx' });
    return publish('npm', npmPublishArgs(p, file), ROOT, { stdio: 'inherit', env: { ...env, NPM_CONFIG_USERCONFIG: config, NODE_AUTH_TOKEN: bootstrapToken } });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export async function main() {
  const dir = resolve(process.argv[2] ?? '');
  const registry = process.argv[3];
  assert(['crates', 'npm'].includes(registry), 'publish registry must be crates or npm');
  assert(registry === 'npm' || !process.env.NPM_ROUTER_BOOTSTRAP_TOKEN, 'router bootstrap belongs only in the npm job');
  const env = cleanPublishEnvironment(process.env);
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REPOSITORY === 'getforma-dev/forma', 'publish only runs in the tag workflow');
  const set = json(join(dir, 'release-set.json'));
  verifyIdentity(set, dir);
  assert.equal(run('git', ['rev-parse', 'HEAD'], ROOT, { env }).trim(), set.commit, 'checkout differs from packed commit');
  assert.equal(run('git', ['diff', '--name-only', 'HEAD'], ROOT, { env }).trim(), '', 'publish checkout must be clean');
  const pending = [];
  // Check every existing version before uploading any new one. A stale or contradictory
  // partial release cannot be resumed merely because a registry returns HTTP 200.
  for (const p of set.packages) {
    const status = await registryStatus(p, dir);
    console.log(`${p.name}@${p.version}: ${status}`);
    if (status === 'missing') pending.push(p);
  }
  if (registry === 'npm') assert(!pending.some(p => p.registry === 'crates'), 'npm must wait for every crate to be published and verified');
  const bootstrap = registry === 'npm' ? await routerBootstrapToken(set, pending, process.env) : undefined;
  // Cargo publishes source, not a supplied .crate. Repackage every crate using precisely the
  // same source, Cargo version and recorded workspace lock; compare bytes before first upload.
  if (registry === 'crates') {
    assert.equal(run('rustc', ['--version'], ROOT, { env }).trim(), set.toolchain, 'repack toolchain changed');
    assert.equal(digest(join(ROOT, 'Cargo.lock')), digest(join(dir, 'Cargo.lock')), 'recorded Cargo.lock differs from tagged lock');
    run('cargo', ['package', '--workspace', '--no-verify', '--locked'], ROOT, { env });
    for (const p of set.packages.filter(p => p.registry === 'crates')) {
      assert.equal(digest(join(ROOT, 'target/package', p.file)), p.sha256, `${p.file}: repack differs from tested bytes`);
    }
  }
  const crates = registry === 'crates' ? pending.filter(p => p.registry === 'crates') : [];
  if (crates.length) run('cargo', cargoPublishArgs(crates), ROOT, { stdio: 'inherit', env });
  // Fixed deadline, hard failure if the newly uploaded bytes cannot be verified. The official
  // cargo workspace publisher already waits for dependency availability in topological order.
  const deadline = Date.now() + 15 * 60_000;
  for (const p of crates) await waitForPackage(p, dir, deadline - Date.now());
  for (const p of registry === 'npm' ? pending.filter(p => p.registry === 'npm') : []) {
    publishNpmPackage(p, join(dir, p.file), env, bootstrap);
    await waitForPackage(p, dir, 5 * 60_000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(`release-publish: ${e.message}`); process.exitCode = 1; });
