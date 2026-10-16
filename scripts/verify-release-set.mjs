#!/usr/bin/env node
// P17 skeleton. Package code comes from DS11; the test harness and third-party tools come
// from the tagged tree's committed lock. No OIDC permission is needed here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { ROOT, NPM, CRATES, json, save, run, digest, stageNpmLock, stageCargoLock, assertCargoCandidateLock, packedRuntimeLock, assertMilestoneReady } from './release-set.mjs';
import { verifyPackedTemplateSources } from './release-template-sources.mjs';
import { verifyMinimalIsland, verifyStaticTemplate } from './release-template-islands.mjs';
import { withOwnedServer } from './owned-server.mjs';
import { linkPackedPackages, assertPackedResolution } from './release-packed-resolution.mjs';
import { auditCandidateSignatures } from './audit-release-signatures.mjs';
import { verifyPackedFixtures } from './release-fixture-apps.mjs';
import { completeMeasurements, machineProfile } from './release-measurements.mjs';
import { verifyWorkerIntegrity, verifyWorkerLifecycle, WORKER_INTEGRITY_CHECKS, WORKER_LIFECYCLE_CHECKS } from '../packages/build/browser-tests/helpers/worker-integrity.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function server(binary, cwd, port, visit, refusal = false) {
  if (port === null) {
    const result = await withOwnedServer(binary, [], cwd, visit, { refusal: Boolean(refusal) });
    if (refusal) {
      const expected = Array.isArray(refusal) ? refusal : ['LOAD-'];
      assert(!result.accepted && result.code !== null && result.code !== 0 && expected.every(text => result.output.includes(text)), `server did not refuse before binding: ${result.output}`);
    }
    return result;
  }
  const child = spawn(binary, [], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = false, code;
  child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  child.once('error', e => { output += String(e); exited = true; });
  const closed = new Promise(resolve => child.once('close', c => { exited = true; code = c; resolve(); }));
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (exited) {
        const expected = Array.isArray(refusal) ? refusal : ['LOAD-'];
        assert(refusal && code !== 0 && expected.every(text => output.includes(text)), `server exited unexpectedly: ${output}`);
        return;
      }
      let response;
      try { response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); }
      catch (e) { if (e.message !== 'fetch failed' && e.name !== 'TimeoutError') throw e; }
      if (response) {
        assert(!refusal, `corrupt module server accepted a connection: ${output}`);
        // Browser test timeouts are failures, not a reason to retry server readiness.
        return await visit(response, `http://127.0.0.1:${port}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`server never ${refusal ? 'refused start' : 'accepted a connection'}: ${output}`);
  } finally { if (!exited) child.kill('SIGTERM'); await closed; }
}
function unpack(file, dest) {
  mkdirSync(dest, { recursive: true });
  const names = run('tar', ['-tzf', file]).trim().split('\n');
  assert(names.every(n => !n.startsWith('/') && !n.split('/').includes('..')), 'unsafe archive path');
  run('tar', ['-xzf', file, '-C', dest, '--strip-components=1']);
}
export function verifyPackedCorpus(manifest, fmir) {
  assert([2, 3].includes(fmir), 'P17 has no verifier for the recorded FMIR contract');
  // Immutable A2 packages keep their integration target. V3's fragment walker is
  // private, so its complete page/fragment corpus lives in the library test module.
  const target = fmir === 2 ? ['--test', 'js_emitter_contract'] : ['--lib', 'js_emitter_contract'];
  const names = [
    'corpus_contains_every_expected_case', 'every_case_parses_as_fmir',
    'slot_names_are_pairwise_unique', 'slot_ids_are_pairwise_unique',
    'every_case_walks_to_html', 'every_island_entry_walks_as_a_fragment',
    fmir === 2 ? 'resolution_cases_ship_named_islands_over_named_slots' : 'resolution_cases_ship_named_contracts_and_client_defaults',
    'corpus_exercises_multibyte_utf8', 'rendered_html_matches_golden',
    ...(fmir === 3 ? ['canonical_dumps_match_the_typescript_emitter'] : []),
  ].map(name => fmir === 3 ? `js_emitter_contract::${name}` : name);
  const args = ['test', '--locked', '--manifest-path', manifest, ...target, '--', '--color', 'never'];
  const env = { ...process.env };
  // The Rust corpus checks presence, so even an empty value would permit writes.
  delete env.UPDATE_GOLDEN;
  const options = { env };
  const listed = run('cargo', [...args, '--list'], ROOT, options).split('\n');
  for (const name of names) assert(listed.includes(`${name}: test`), `packed corpus is missing ${name}`);
  const output = run('cargo', args, ROOT, options);
  process.stdout.write(output);
  // Cargo succeeds for an empty filter or ignored tests. Require each semantic
  // check to have executed successfully, not merely to exist in the archive.
  const completed = output.split('\n');
  for (const name of names) assert(completed.includes(`test ${name} ... ok`), `packed corpus did not execute ${name}`);
}
// Required by the recorded declared-v1 props contract. Never accept an empty
// Cargo target, a filtered/ignored check or bytes from the source compiler.
export function verifyPackedPropsTests(manifest, { boundRender = false } = {}) {
  const names = [
    'actual_compiler_module_binds_by_declared_names_and_renders_two_list_views',
    'every_request_checks_numeric_and_date_bounds_with_declared_paths',
    'bind_errors_stop_startup_before_listener_and_keep_both_source_positions',
    'unknown_browser_and_ambiguous_pages_refuse_binding',
    'no_parameter_and_typed_empty_pages_bind_without_handler_filling_local_lists',
    'reload::reload_keeps_last_good_files_and_rechecks_new_schema_with_matching_asset_snapshot',
    'reload::rejected_or_missing_manifest_freezes_the_entire_pair_until_valid_recovery',
  ];
  if (boundRender) names.push(
    'finalization_refuses_every_unbound_route_without_partly_sealing_then_repairs',
    'finalization_refuses_a_bind_already_comparing_on_another_thread',
    'two_routes_sharing_an_alias_need_two_successful_exact_bindings',
    'bind_limits_inherit_and_request_overrides_never_change_sibling_defaults',
    'typed_ssr_preserves_escaped_json_css_and_explicit_raw_prefix_with_response_policy',
    'only_declared_browser_routes_have_shells_and_an_empty_registry_can_finalize',
    'a_props_conversion_unwind_is_one_request_fault_and_the_next_request_renders',
    'reload::finalized_topology_refusal_freezes_edited_modules_and_assets_until_compatible_recovery',
  );
  const args = ['test', '--locked', '--manifest-path', manifest, '--test', 'typed_pages', '--', '--color', 'never'];
  const env = { ...process.env };
  delete env.UPDATE_GOLDEN;
  const options = { env };
  const listed = run('cargo', [...args, '--list'], ROOT, options).split('\n');
  for (const name of names) assert(listed.includes(`${name}: test`), `packed props are missing ${name}`);
  const output = run('cargo', args, ROOT, options);
  process.stdout.write(output);
  const completed = output.split('\n');
  for (const name of names) assert(completed.includes(`test ${name} ... ok`), `packed props did not execute ${name}`);
}
// Every native public-path control must run from the actual packed crate.
export function verifyPackedIntegrityTests(manifest) {
  const names = [
    'both_public_document_paths_write_exact_integrity_and_keep_nonces',
    'every_asset_requires_full_canonical_integrity_before_startup',
    'constructed_browser_manifests_and_stale_preload_tables_refuse_unchecked_tags',
  ];
  const args = ['test', '--locked', '--manifest-path', manifest, '--test', 'asset_integrity', '--', '--color', 'never'];
  const listed = run('cargo', [...args, '--list'], ROOT).split('\n');
  for (const name of names) assert(listed.includes(`${name}: test`), `packed integrity is missing ${name}`);
  const output = run('cargo', args, ROOT);
  process.stdout.write(output);
  for (const name of names) assert(output.split('\n').includes(`test ${name} ... ok`), `packed integrity did not execute ${name}`);
}

// Observations come from the browser's parsed actual packed-server response.
export function requireAssetIntegrity(resources, manifest, route = '/') {
  const declared = manifest.routes[route];
  assert(declared, 'resource integrity has no declared route');
  const counts = new Map();
  for (const resource of resources) {
    assert(resource.url?.startsWith('/_assets/'), `resource URL is not a build asset: ${resource.url}`);
    const file = resource.url.slice('/_assets/'.length), metadata = manifest.assets[file];
    assert(metadata && /^sha384-[A-Za-z0-9+/]{64}$/.test(metadata.integrity), `resource ${file} lacks canonical manifest SHA-384`);
    assert.equal(resource.integrity, metadata.integrity, `resource ${file} has wrong or missing integrity`);
    assert.equal(resource.crossorigin, 'anonymous', `resource ${file} has no anonymous crossorigin`);
    if (resource.tag === 'SCRIPT' || resource.rel === 'modulepreload') assert(resource.nonce, `resource ${file} lost its nonce`);
    const kind = resource.tag === 'SCRIPT' ? 'script' : resource.rel;
    assert(['script', 'stylesheet', 'modulepreload'].includes(kind), `unexpected protected resource ${kind}`);
    const key = `${kind}:${file}`; counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) assert.equal(count, 1, `resource ${key} is duplicated`);
  const expected = new Map();
  const expect = (kind, file) => { const key = `${kind}:${file}`; expected.set(key, (expected.get(key) || 0) + 1); };
  for (const file of declared.css) expect('stylesheet', file);
  for (const file of declared.js) expect('modulepreload', file);
  if (declared.js.length) expect('script', declared.js.at(-1));
  for (const [key, count] of expected) assert.equal(counts.get(key), count, `resource ${key} is missing or duplicated`);
  return resources;
}

// P17 requires every named browser assertion; a resolved but partial result is a failure.
export function requireWorkerChecks(observation, names, app) {
  assert.equal(observation.passed, true, 'worker replay did not pass');
  assert.equal(observation.app, app, 'worker replay used a different application');
  assert.deepEqual(observation.results?.map(result => result.name), names, 'worker replay omitted or duplicated a required check');
  for (const result of observation.results) assert.equal(result.passed, true, `worker replay did not execute ${result.name}`);
  const { directory, ...portable } = observation;
  return portable;
}

export function verifyPackedPropsFixtures(compiler, serverCrate) {
  assert.equal(typeof compiler.generateRealIr, 'function', 'packed compiler lacks its IR emitter');
  for (const [app, name] of [['app', 'home'], ['empty-app', 'empty'], ['empty-typed-app', 'empty-typed']]) {
    const entry = join(ROOT, 'packages/compiler/tests/fixtures/props-contract', `${app}.ts`);
    const emitted = compiler.generateRealIr(entry);
    assert(emitted?.binary, `${name}: declared props compiler fell back to placeholder`);
    assert.deepEqual(Buffer.from(emitted.binary), readFileSync(join(serverCrate, 'tests/fixtures/props-contract', `${name}.ir`)), `${name}: emitted declared props differ from packed server fixture`);
  }
}
// Inspect the actual response's enforced policy, never a Report-Only fallback.
export function requireEnforcedTrustedTypes(headers) {
  const policy = headers.get('content-security-policy');
  assert(policy, 'packed template lacks an enforced Content-Security-Policy');
  const directives = new Map();
  for (const part of policy.split(';').map(part => part.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    assert(!directives.has(name), `packed template has duplicate ${name} directives`);
    directives.set(name, values);
  }
  assert.deepEqual(directives.get('require-trusted-types-for'), ["'script'"], 'packed template does not require Trusted Types for script sinks');
  assert.deepEqual(directives.get('trusted-types')?.slice().sort(), ['forma', 'forma-runtime'], 'packed template allows unexpected Trusted Types policies');
  return policy;
}

async function verifyPackedBrowserSri(browser, origin, entry) {
  const observations = [];
  for (const protectedTag of [true, false]) {
    const page = await browser.newPage();
    let served = 0;
    try {
      if (!protectedTag) await page.route(`${origin}/`, async route => {
        const response = await route.fetch();
        // A paired control: the identical harmless replacement must execute
        // when only SRI is removed. Keep the real document's nonce and headers.
        await route.fulfill({ response, body: (await response.text()).replace(/ integrity="[^"]*"/g, '') });
      });
      await page.route(`${origin}/_assets/${entry}`, async route => {
        served++;
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'globalThis.__formaP17AlteredEntry = true;' });
      });
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 20_000 });
      const executed = await page.evaluate(() => Boolean(globalThis.__formaP17AlteredEntry));
      assert(served > 0, 'SRI control never served the replacement entry');
      assert.equal(executed, !protectedTag, protectedTag ? 'altered entry executed despite SRI' : 'paired no-SRI control did not execute the same replacement');
      observations.push({ protectedTag, replacementRequests: served, replacementExecuted: executed });
    } finally { await page.close(); }
  }
  return observations;
}

export async function verify(dir, reportPath) {
  assert(!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'P17 must not have an OIDC credential');
  const started = Date.now(), set = json(join(dir, 'release-set.json'));
  assert([undefined, null, 'enforced-v1'].includes(set.contracts.trustedTypes), 'P17 has no verifier for the recorded Trusted Types contract');
  assert([null, 'declared-v1'].includes(set.contracts.props), 'P17 has no verifier for the recorded props contract');
  assert([undefined, null, 'finalized-v1'].includes(set.contracts.boundRender), 'P17 has no verifier for the recorded bound rendering contract');
  assert([undefined, null, 'sha384-v1'].includes(set.contracts.assetIntegrity), 'P17 has no verifier for the recorded asset integrity contract');
  assert([undefined, null, 'declared-v1', 'islands-v1'].includes(set.contracts.sourceTemplates), 'P17 has no verifier for the recorded source template contract');
  assert([undefined, null, 'declared-v1'].includes(set.contracts.stateBlock), 'P17 has no verifier for the recorded state block contract');
  assert([undefined, null, 'declared-v1'].includes(set.contracts.fixtureApps), 'P17 has no verifier for the recorded fixture applications contract');
  if (set.contracts.fixtureApps) {
    // The fixtures are 3.0.0 pages: declared props, the state block, strict adoption (FORMA-188).
    assert.equal(set.contracts.props, 'declared-v1', 'fixture applications require declared props');
    assert.equal(set.contracts.stateBlock, 'declared-v1', 'fixture applications require declared state');
    assert.equal(set.contracts.boundRender, 'finalized-v1', 'fixture applications require finalized rendering');
    assert.equal(set.contracts.sourceTemplates, 'islands-v1', 'fixture applications require strict adoption');
  }
  const islandTemplates = set.contracts.sourceTemplates === 'islands-v1';
  if (set.contracts.sourceTemplates) assert.equal(set.contracts.boundRender, 'finalized-v1');
  if (islandTemplates) assert.equal(set.contracts.stateBlock, 'declared-v1', 'islands templates require declared state');
  if (set.contracts.assetIntegrity === 'sha384-v1') assert.equal(set.contracts.manifest, 2, 'asset integrity requires schema2');
  if (set.contracts.boundRender === 'finalized-v1') assert.equal(set.contracts.props, 'declared-v1', 'finalized rendering requires the declared props checks');
  for (const p of set.packages) assert.equal(digest(join(dir, p.file)), p.sha256, `${p.file}: wrong packed bytes`);
  const scratch = join(ROOT, `.release-verify-${process.pid}`);
  mkdirSync(scratch);
  const cli = mkdtempSync(join(tmpdir(), 'forma-packed-cli-'));
  const report = { schema: 1, commit: set.commit, passed: false, tests: [], milestone: set.milestone ?? null, signatures: 'registry dependencies via npm audit signatures; unpublished local artifacts via pinned DS11 SHA-256', templates: [] };
  const test = async (name, fn) => { console.log(`P17: ${name}`); const at = Date.now(); await fn(); report.tests.push({ name, passed: true, seconds: (Date.now() - at) / 1000 }); };
  try {
    for (const p of set.packages) {
      unpack(join(dir, p.file), p.name === '@getforma/create-app' ? cli : join(scratch, p.path));
      if (p.registry === 'crates') {
        const manifest = join(scratch, p.path, 'Cargo.toml');
        writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n[workspace]\n');
      }
    }
    // The packed libraries resolve one another inside the scratch, never through the root's
    // workspace links: the verify job never builds packages/*, and a built workstation must
    // not stand in for the packed bytes (the v3.0.0-alpha.1 tag, run 38764599499).
    await test('packed npm packages resolve one another inside the packed set, never through the workspace', async () => {
      report.packedLinks = linkPackedPackages(scratch, set.packages);
      report.packedResolution = assertPackedResolution(scratch, set.packages);
      assert(report.packedResolution.some(edge => edge.package === '@getforma/build' && edge.specifier === '@getforma/compiler'), 'the packed build no longer imports its compiler peer; update this check');
    });
    if (set.contracts.sourceTemplates) await test('packed templates contain exact checked-in Rust and TypeScript sources', async () => {
      report.sourceEquality = verifyPackedTemplateSources(cli, set.commit, set.contracts.sourceTemplates);
    });
    await test('fresh advisories over every exact shipped crate lock', async () => {
      for (const p of set.packages.filter(p => p.registry === 'crates')) {
        const crate = join(scratch, p.path), manifest = join(crate, 'Cargo.toml'), lock = join(crate, 'Cargo.lock');
        const shippedLockSha256 = digest(lock);
        // Registry checksums for unpublished internal packages cannot resolve before upload.
        // Patch only those packages to the DS11 source and preserve all third-party locks.
        const text = readFileSync(lock, 'utf8');
        assertCargoCandidateLock(text, set.packages, p.name);
        const present = CRATES.filter(n => n !== p.name && text.includes(`name = "${n}"`));
        if (present.length) {
          writeFileSync(lock, stageCargoLock(text, set.packages, true, p.name));
          writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n[patch.crates-io]\n' + present.map(n => `${n} = { path = ${JSON.stringify(join(scratch, 'crates', n))} }`).join('\n') + '\n');
        }
        const auditLockSha256 = digest(lock);
        run('bash', ['scripts/check-advisories.sh', manifest], ROOT, { stdio: 'inherit' });
        assert.equal(digest(lock), auditLockSha256, `${p.name}: advisory check changed the recorded graph`);
        report.tests.push({ name: `${p.name}: packed Cargo.lock advisories`, passed: true, shippedLockSha256, auditLockSha256 });
      }
    });
    await test('packed CLI has an isolated, locked runtime dependency installation', async () => {
      const runtime = packedRuntimeLock(json(join(cli, 'package.json')), json(join(ROOT, 'package-lock.json')), 'packages/create-app');
      save(join(cli, 'package.json'), runtime.manifest); save(join(cli, 'package-lock.json'), runtime.lock);
      const lockHash = digest(join(cli, 'package-lock.json'));
      run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], cli, { stdio: 'inherit' });
      assert.equal(digest(join(cli, 'package-lock.json')), lockHash, 'npm changed the packed CLI runtime lock');
      const signatures = auditCandidateSignatures(cli, set.packages, dir);
      report.tests.push({ name: 'packed CLI registry signatures', passed: true, ...signatures });
    });
    await test('packed compiler emits the frozen corpus read by packed forma-ir', async () => {
      const compiler = await import(pathToFileURL(join(scratch, 'packages/compiler/dist/index.js')).href);
      const { generateRealIr } = compiler;
      assert([2, 3].includes(set.contracts.fmir), 'P17 has no verifier for the recorded FMIR contract');
      const corpus = join(ROOT, 'packages/compiler/tests/fixtures/ir-corpus');
      const emitted = join(scratch, 'crates/forma-ir/tests/fixtures/js-emitter');
      const cases = readdirSync(corpus, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      assert(cases.length >= 14, 'the conformance corpus shrank');
      for (const name of cases) {
        const entry = ['app.ts', 'app.tsx'].map(f => join(corpus, name, f)).find(existsSync);
        const result = generateRealIr(entry);
        assert(result && !result.islands.some(i => i.name === 'createList' || /^island_\d+$/.test(i.name)), `${name}: compiler fell back to placeholder`);
        const bytes = result.binary;
        assert(bytes, `${name}: compiler result has no IR bytes`);
        assert.deepEqual(Buffer.from(bytes), readFileSync(join(emitted, `${name}.ir`)), `${name}: emitted bytes differ from packed reader corpus`);
        if (set.contracts.fmir === 3) {
          assert.equal(typeof compiler.readFmirContainer, 'function', 'packed v3 compiler lacks its container reader');
          assert.equal(typeof compiler.dumpFmir, 'function', 'packed v3 compiler lacks its canonical dump');
          const reader = set.packages.find(p => p.name === 'forma-ir');
          const expectedVersion = reader.version.split('-')[0].split('.').map(Number);
          assert.deepEqual(compiler.readFmirContainer(bytes).writer, expectedVersion, `${name}: writer does not match packed Rust reader`);
          assert.equal(compiler.dumpFmir(bytes), readFileSync(join(emitted, `${name}.dump`), 'utf8'), `${name}: canonical dump differs from packed reader corpus`);
        }
      }
      verifyPackedCorpus(join(scratch, 'crates/forma-ir/Cargo.toml'), set.contracts.fmir);
    });
    if (set.contracts.props === 'declared-v1') {
      await test('packed compiler declared props bind and render through packed typed Pages', async () => {
        const compiler = await import(pathToFileURL(join(scratch, 'packages/compiler/dist/index.js')).href);
        const serverCrate = join(scratch, 'crates/forma-server');
        verifyPackedPropsFixtures(compiler, serverCrate);
        verifyPackedPropsTests(join(serverCrate, 'Cargo.toml'), { boundRender: set.contracts.boundRender === 'finalized-v1' });
      });
    }
    if (set.contracts.assetIntegrity === 'sha384-v1') await test('packed reader requires full digests on every public document path', async () => verifyPackedIntegrityTests(join(scratch, 'crates/forma-server/Cargo.toml')));
    const { chromium, firefox, webkit } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      if (set.contracts.assetIntegrity === 'sha384-v1') {
        const { build } = await import(pathToFileURL(join(scratch, 'packages/build/dist/index.js')).href);
        assert.equal(typeof build, 'function', 'packed build package lacks build()');
        const app = 'p17-integrity';
        const options = { build, browser, workDir: join(scratch, 'worker-browser'), app };
        await test('packed build verifies cached and network bytes including dynamic chunks and compressed delivery', async () => {
          report.workerIntegrity = requireWorkerChecks(await verifyWorkerIntegrity(options), WORKER_INTEGRITY_CHECKS, app);
        });
        await test('packed builds preserve waiting lifecycle and actual packed Rust retirement', async () => {
          const retiringWorkerSource = run('cargo', ['run', '--quiet', '--locked', '--manifest-path', join(scratch, 'crates/forma-server/Cargo.toml'), '--example', 'retiring_worker_source', '--', app], ROOT,
            { env: { ...process.env, CARGO_TARGET_DIR: join(scratch, 'target') } });
          const sourcePath = join(scratch, 'retiring-worker.js');
          writeFileSync(sourcePath, retiringWorkerSource);
          report.workerLifecycle = { ...requireWorkerChecks(await verifyWorkerLifecycle({ ...options, retiringWorkerSource }), WORKER_LIFECYCLE_CHECKS, app), retiringWorkerSha256: digest(sourcePath) };
        });
      }
      for (const template of ['minimal', 'dashboard']) {
        await test(`${template}: packed CLI, locked install, signatures, build, serve and interaction`, async () => {
          const name = `release-${template}`;
          run(process.execPath, [join(cli, 'dist/index.js'), name, '--template', template], scratch, { env: { ...process.env, NODE_PATH: '' } });
          const project = join(scratch, name), admin = join(project, 'admin');
          const staged = stageNpmLock(json(join(admin, 'package.json')), json(join(admin, 'package-lock.json')), set.packages, dir, true);
          save(join(admin, 'package.json'), staged.manifest); save(join(admin, 'package-lock.json'), staged.lock);
          const npmHash = digest(join(admin, 'package-lock.json'));
          run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], admin, { stdio: 'inherit' });
          const signatures = auditCandidateSignatures(admin, set.packages, dir);
          report.tests.push({ name: `${template}: registry signatures and DS11 candidate authentication`, passed: true, ...signatures });
          for (const p of set.packages.filter(p => p.registry === 'npm' && p.name !== '@getforma/create-app')) {
            const manifest = join(admin, 'node_modules', p.name, 'package.json');
            if (existsSync(manifest)) assert.equal(json(manifest).version, p.version, `${template} installed another ${p.name}`);
          }
          run('npm', ['run', template === 'minimal' ? 'build:ssr' : 'build'], admin, { stdio: 'inherit' });
          assert.equal(digest(join(admin, 'package-lock.json')), npmHash, 'npm changed the candidate lock');
          if (set.contracts.manifest === 2) {
            const manifest = json(join(admin, 'dist/manifest.json'));
            const buildVersion = set.packages.find(p => p.name === '@getforma/build').version.split('-')[0];
            assert.equal(manifest.version, 2); assert.equal(manifest.writer, buildVersion);
            assert.equal(manifest.app, name); assert.equal(manifest.routes['/'].mode, template === 'minimal' ? 'ssr' : 'browser');
            for (const [file, metadata] of Object.entries(manifest.assets)) {
              assert.equal(typeof metadata.immutable, 'boolean', `${template}: ${file} has no cache metadata`);
              assert.equal(metadata.integrity, `sha384-${digest(join(admin, 'dist', file), 'sha384', 'base64')}`, `${template}: ${file} digest is not its uncompressed bytes`);
              assert(!/\.(?:br|gz)$/.test(file), 'compression sidecars must not be primary manifest assets');
            }
            for (const file of Object.values(manifest.aliases)) assert(manifest.assets[file], `${template}: alias lacks metadata`);
            report.tests.push({ name: `${template}: packed manifest 2 identity, modes, aliases and uncompressed SHA-384`, passed: true });
          }
          // Substitute just the candidate crate sources, never the registry's already-published
          // version. The dependency graph and all third-party checksums stay locked.
          let lock = readFileSync(join(project, 'Cargo.lock'), 'utf8');
          const present = CRATES.filter(n => lock.includes(`name = "${n}"`));
          lock = stageCargoLock(lock, set.packages, true);
          writeFileSync(join(project, 'Cargo.lock'), lock);
          const patch = '\n[workspace]\n\n[patch.crates-io]\n' + present.map(n => `${n} = { path = ${JSON.stringify(join(scratch, 'crates', n))} }`).join('\n') + '\n';
          writeFileSync(join(project, 'Cargo.toml'), readFileSync(join(project, 'Cargo.toml'), 'utf8') + patch);
          const port = set.contracts.sourceTemplates ? null : await freePort(), main = join(project, 'src/main.rs');
          const source = readFileSync(main, 'utf8');
          if (port !== null) {
            const listener = template === 'minimal' ? '127.0.0.1:3000' : '{host}:3000';
            assert(source.includes(listener), 'historical template listener changed; update P17 adapter');
            writeFileSync(main, source.replaceAll(listener, `127.0.0.1:${port}`));
          }
          run('cargo', ['build', '--locked'], project, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: join(scratch, 'target') } });
          const binary = join(scratch, 'target/debug', process.platform === 'win32' ? `${name}.exe` : name);
          await server(binary, project, port, async (response, origin) => {
            assert.equal(response.status, 200);
            const enforced = set.contracts.trustedTypes === 'enforced-v1';
            const servedPolicy = enforced ? requireEnforcedTrustedTypes(response.headers) : response.headers.get('content-security-policy');
            const html = await response.text();
            assert(!/<div id="app"[^>]*><\/div>/.test(html) || template === 'dashboard', 'minimal SSR is an empty shell');
            const page = await browser.newPage();
            page.setDefaultTimeout(15_000);
            const errors = []; page.on('pageerror', e => errors.push(e.message));
            // Install before navigation: a CSP violation need not throw a pageerror.
            await page.addInitScript(() => {
              globalThis.__formaP17Violations = [];
              document.addEventListener('securitypolicyviolation', event => {
                globalThis.__formaP17Violations.push({ directive: event.effectiveDirective, disposition: event.disposition, blockedURI: event.blockedURI });
              });
            });
            try {
              const navigation = await page.goto(origin, { waitUntil: 'networkidle', timeout: 20_000 });
              assert(navigation, 'packed template navigation produced no response');
              const browserHeaders = new Headers(await navigation.allHeaders());
              const browserPolicy = enforced ? requireEnforcedTrustedTypes(browserHeaders) : browserHeaders.get('content-security-policy');
              if (set.contracts.assetIntegrity === 'sha384-v1') {
                const resources = await page.locator('script[src], link[rel="stylesheet"], link[rel="modulepreload"]').evaluateAll(elements => elements.map(el => ({
                  tag: el.tagName, rel: el.getAttribute('rel'), url: el.getAttribute(el.tagName === 'SCRIPT' ? 'src' : 'href'),
                  integrity: el.getAttribute('integrity'), crossorigin: el.getAttribute('crossorigin'), nonce: el.nonce,
                })));
                requireAssetIntegrity(resources, json(join(admin, 'dist/manifest.json')));
                report.tests.push({ name: `${template}: actual packed server resource tags carry manifest SHA-384 and nonces`, passed: true, resources });
              }
              if (template === 'minimal') {
                await page.getByRole('button', { name: 'Increment', exact: true }).click();
                await page.locator('.count span').filter({ hasText: islandTemplates ? /^8$/ : /^1$/ }).waitFor();
              } else {
                await page.getByRole('button', { name: /^Deployments(?:\s|$)/ }).click();
                await page.locator('h1').filter({ hasText: 'Deployments' }).waitFor();
              }
              // Historical activation removed status markers. Strict adoption keeps
              // the original DOM; its separate held-module observer proves success.
              if (!islandTemplates || template === 'dashboard') {
                const assertActivated = async () => assert.equal(await page.locator('[data-forma-status="pending"], [data-forma-status="hydrating"], [data-forma-status="error"]').count(), 0, 'island did not activate after load');
                await assertActivated();
                // Real DOM negative control: the gate must reject the runtime's actual marker.
                await page.evaluate(() => { const el = document.createElement('div'); el.id = 'p17-pending-probe'; el.setAttribute('data-forma-status', 'pending'); document.body.append(el); });
                await assert.rejects(assertActivated, /did not activate/);
                await page.locator('#p17-pending-probe').evaluate(el => el.remove());
                await assertActivated();
              }
              // Native violation events are queued; collect them after positive interaction.
              const observation = await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve({
                nativeTrustedTypes: typeof globalThis.trustedTypes?.isHTML === 'function',
                violations: globalThis.__formaP17Violations,
              }), 100)));
              if (enforced) assert.equal(observation.nativeTrustedTypes, true, 'packed enforcement gate requires a native Trusted Types engine');
              assert.deepEqual(observation.violations, [], 'CSP violation in packed template');
              assert.deepEqual(errors, [], 'browser error in packed template');
              report.tests.push({ name: `${template}: served policy and zero CSP violations during positive browser interaction`, passed: true,
                trustedTypesContract: set.contracts.trustedTypes ?? null, servedPolicy, browserPolicy, ...observation, pageErrors: errors });
            } finally { await page.close(); }
            if (template === 'minimal' && islandTemplates) {
              const manifest = json(join(admin, 'dist/manifest.json'));
              assert.match(html.replace(/<!--[\s\S]*?-->/g, ''), /Count:\s*<span[^>]*>7<\/span>/, 'original handler count is missing before JavaScript');
              // Observe release behavior without replacing the debug binary: the
              // corrupt-file controls below require rust-embed's debug disk reads.
              // Debug's deliberate endpoint-free Report-Only TT logs in WebKit.
              run('cargo', ['build', '--locked', '--release'], project, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: join(scratch, 'target') } });
              const releaseBinary = join(scratch, 'target/release', process.platform === 'win32' ? `${name}.exe` : name);
              await server(releaseBinary, project, null, async (releaseResponse, releaseOrigin) => {
                assert.equal(releaseResponse.headers.get('content-security-policy-report-only'), null, 'strict release template has an unexpected diagnostic policy');
                for (const [engine, launcher] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
                  const actual = engine === 'chromium' ? browser : await launcher.launch();
                  try {
                    const island = await verifyMinimalIsland(actual, releaseOrigin, manifest);
                    const staticRoute = await verifyStaticTemplate(actual, releaseOrigin, manifest);
                    report.tests.push({ name: `minimal: ${engine} packed native adoption and static route`, passed: true, engine, profile: 'release', island, staticRoute });
                  } finally { if (actual !== browser) await actual.close(); }
                }
              });
            }
            if (set.contracts.assetIntegrity === 'sha384-v1') {
              const manifest = json(join(admin, 'dist/manifest.json'));
              const entry = manifest.routes['/'].js.at(-1);
              assert(entry, 'SRI browser control requires the actual template entry');
              const observations = await verifyPackedBrowserSri(browser, origin, entry);
              report.tests.push({ name: `${template}: browser blocks changed actual entry bytes using packed server SRI`, passed: true, observations });
            }
          });
          if (template === 'minimal' && set.contracts.sourceTemplates === 'declared-v1') {
            const original = readFileSync(main, 'utf8');
            const changed = original.replace('home.render(&HomeProps { count: 0 }, &ctx)', 'home.render(&HomeProps { count: 7 }, &ctx)');
            assert.notEqual(changed, original, 'count7 control must use the actual typed handler');
            try {
              writeFileSync(main, changed);
              run('cargo', ['build', '--locked'], project, {stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:join(scratch,'target')}});
              await server(binary, project, port, async response => {
                assert.equal(response.status, 200);
                const body = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
                assert.match(body, /Count:\s*<span[^>]*>7<\/span>/, 'handler count did not reach the raw HTTP document');
              });
              report.tests.push({name:'minimal: typed handler count7 reaches actual SSR before JavaScript',passed:true,serverCount:7,clientActivationChecked:false});
            } finally {
              writeFileSync(main, original);
              run('cargo', ['build', '--locked'], project, {stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:join(scratch,'target')}});
            }
          }
          if (template === 'minimal') {
            const manifest = json(join(admin, 'dist/manifest.json'));
            const ir = join(admin, 'dist', manifest.routes['/'].ir);
            const bytes = readFileSync(ir);
            try {
              writeFileSync(ir, bytes.subarray(0, 12));
              await server(binary, project, port, async () => {}, true);
              report.tests.push({ name: 'packed loader refuses a corrupt module before binding', passed: true });
              if (set.contracts.manifest === 2) {
                const compiler = await import(pathToFileURL(join(scratch, 'packages/compiler/dist/index.js')).href);
                const container = compiler.readFmirContainer(bytes), future = [...container.writer]; future[1]++;
                writeFileSync(ir, compiler.encodeFmirSections(container.sections, future));
                await server(binary, project, port, async () => {}, ['LOAD-108', future.join('.'), container.writer.join('.')]);
                report.tests.push({ name: 'packed loader refuses a newer-minor module before binding, naming both versions', passed: true });
              }
            } finally { writeFileSync(ir, bytes); }
          }
          if (set.contracts.manifest === 2) {
            const manifestPath = join(admin, 'dist/manifest.json'), bytes = readFileSync(manifestPath);
            const manifest = JSON.parse(bytes), reader = set.packages.find(p => p.name === 'forma-server').version.split('-')[0];
            const future = reader.split('.').map(Number); future[1]++;
            for (const [change, expected] of [
              [{ version: 1 }, ['MANIFEST-101']],
              [{ app: undefined }, ['schema-1']],
              [{ writer: future.join('.') }, ['MANIFEST-102', future.join('.'), reader]],
            ]) {
              try {
                save(manifestPath, { ...manifest, ...change });
                await server(binary, project, port, async () => {}, expected);
              } finally { writeFileSync(manifestPath, bytes); }
            }
            report.tests.push({ name: `${template}: packed manifest schema/app/writer refused before binding`, passed: true });
            if (set.contracts.assetIntegrity === 'sha384-v1') {
              const asset = manifest.routes['/'].js.at(-1);
              assert(asset, 'packed integrity refusal requires a declared entry');
              for (const integrity of [undefined, null, 'sha384-short', `sha256-${'A'.repeat(64)}`]) {
                try {
                  const invalid = structuredClone(manifest);
                  invalid.assets[asset].integrity = integrity;
                  save(manifestPath, invalid);
                  await server(binary, project, port, async () => {}, ['MANIFEST-103', asset]);
                } finally { writeFileSync(manifestPath, bytes); }
              }
              report.tests.push({ name: `${template}: packed manifest missing and malformed digests refused before binding`, passed: true });
            }
            const off = 'sw::configure(sw::ServiceWorker::off())';
            const mainSource = readFileSync(main, 'utf8'); assert(mainSource.includes(off), 'template worker startup changed; update P17 adapter');
            writeFileSync(main, mainSource.replace(off, `sw::configure_for_manifest(sw::ServiceWorker::for_app(${JSON.stringify(name)}).unwrap().enabled(), &manifest)`));
            run('cargo', ['build', '--locked'], project, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: join(scratch, 'target') } });
            // A matching enabled worker can start; only the manifest app changes
            // for the refusal. The candidate server code and binary stay identical.
            await server(binary, project, port, async response => assert.equal(response.status, 200));
            try {
              save(manifestPath, { ...manifest, app: 'p17-other' });
              await server(binary, project, port, async () => {}, [name, 'p17-other']);
            } finally { writeFileSync(manifestPath, bytes); writeFileSync(main, mainSource); }
            report.tests.push({ name: `${template}: packed checked worker accepts matching app and refuses mismatch before binding`, passed: true });
          }
          report.templates.push({ template, npmLockSha256: npmHash, packedPackages: set.packages.map(p => `${p.name}@${p.version}`) });
        });
      }
      // The fixture applications (FORMA-188): the same sources and checks as the source lane, against the
      // packed set. The skew drill is FORMA-186's lane and is not called here yet; stageFixtureProject
      // returns what it will take (project, build, targetDir, cratesDir).
      if (set.contracts.fixtureApps) {
        report.fixtures = await verifyPackedFixtures({ set, dir, cratesDir: join(scratch, 'crates'), targetDir: join(scratch, 'target'), browser, test, report });
      }
    } finally { await browser.close(); }
    // A live set publishes only for the milestone its tag names, and only when every gate of
    // that milestone and the earlier ones is done. Dry runs exercise the contracts unenforced.
    if (!set.dryRun) {
      const milestone = assertMilestoneReady(set.contracts, set.tag.slice(1));
      assert.equal(set.milestone?.name, milestone.name, 'packed set names another milestone');
    }
    report.elapsedSeconds = (Date.now() - started) / 1000;
    if (report.fixtures) {
      // The measurement step (FORMA-188): P17's time against G6, Forma's code per fixture route against
      // N2, the machine and profile; a missing or over-limit figure fails P17 naming it. FORMA-191 adds rows.
      const { n2, shapes, expectedRoutes } = report.fixtures;
      report.measurements = completeMeasurements({
        machine: machineProfile({ rustc: set.toolchain, npm: set.npm }), seconds: report.elapsedSeconds, n2, shapes, expectedRoutes,
      });
    }
    report.passed = true;
    save(reportPath, report);
  } finally {
    if (!report.passed) save(reportPath, { ...report, elapsedSeconds: (Date.now() - started) / 1000 });
    // Keep logs/report outside scratch; remove only this invocation's own output.
    rmSync(scratch, { recursive: true, force: true });
    rmSync(cli, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verify(resolve(process.argv[2]), resolve(process.argv[3])).catch(e => { console.error(`P17: ${e.stack}`); process.exitCode = 1; });
