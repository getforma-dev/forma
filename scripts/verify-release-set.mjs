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
import { ROOT, NPM, CRATES, json, save, run, digest, stageNpmLock, stageCargoLock, assertCargoCandidateLock, packedRuntimeLock } from './release-set.mjs';
import { auditCandidateSignatures } from './audit-release-signatures.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function server(binary, cwd, port, visit, refusal = false) {
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
    'resolution_cases_ship_named_islands_over_named_slots',
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

export async function verify(dir, reportPath) {
  assert(!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'P17 must not have an OIDC credential');
  const started = Date.now(), set = json(join(dir, 'release-set.json'));
  assert([undefined, null, 'enforced-v1'].includes(set.contracts.trustedTypes), 'P17 has no verifier for the recorded Trusted Types contract');
  assert([null, 'declared-v1'].includes(set.contracts.props), 'P17 has no verifier for the recorded props contract');
  assert([undefined, null, 'finalized-v1'].includes(set.contracts.boundRender), 'P17 has no verifier for the recorded bound rendering contract');
  if (set.contracts.boundRender === 'finalized-v1') assert.equal(set.contracts.props, 'declared-v1', 'finalized rendering requires the declared props checks');
  for (const p of set.packages) assert.equal(digest(join(dir, p.file)), p.sha256, `${p.file}: wrong packed bytes`);
  const scratch = join(ROOT, `.release-verify-${process.pid}`);
  mkdirSync(scratch);
  const cli = mkdtempSync(join(tmpdir(), 'forma-packed-cli-'));
  const report = { schema: 1, commit: set.commit, passed: false, tests: [], pending: set.contracts.pending, signatures: 'registry dependencies via npm audit signatures; unpublished local artifacts via pinned DS11 SHA-256', templates: [] };
  const test = async (name, fn) => { console.log(`P17: ${name}`); const at = Date.now(); await fn(); report.tests.push({ name, passed: true, seconds: (Date.now() - at) / 1000 }); };
  try {
    for (const p of set.packages) {
      unpack(join(dir, p.file), p.name === '@getforma/create-app' ? cli : join(scratch, p.path));
      if (p.registry === 'crates') {
        const manifest = join(scratch, p.path, 'Cargo.toml');
        writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n[workspace]\n');
      }
    }
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
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
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
          const port = await freePort(), main = join(project, 'src/main.rs');
          const source = readFileSync(main, 'utf8');
          const listener = template === 'minimal' ? '127.0.0.1:3000' : '{host}:3000';
          assert(source.includes(listener), 'template listener changed; update P17 adapter');
          writeFileSync(main, source.replaceAll(listener, `127.0.0.1:${port}`));
          run('cargo', ['build', '--locked'], project, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: join(scratch, 'target') } });
          const binary = join(scratch, 'target/debug', name);
          await server(binary, project, port, async (response, origin) => {
            assert.equal(response.status, 200);
            const enforced = set.contracts.trustedTypes === 'enforced-v1';
            const servedPolicy = enforced ? requireEnforcedTrustedTypes(response.headers) : response.headers.get('content-security-policy');
            const html = await response.text();
            assert(!html.includes('<div id="app"></div>') || template === 'dashboard', 'minimal SSR is an empty shell');
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
              if (template === 'minimal') {
                await page.getByRole('button', { name: 'Increment', exact: true }).click();
                await page.locator('.count').filter({ hasText: 'Count: 1' }).waitFor();
              } else {
                await page.getByRole('button', { name: /^Deployments(?:\s|$)/ }).click();
                await page.locator('h1').filter({ hasText: 'Deployments' }).waitFor();
              }
              const assertActivated = async () => assert.equal(await page.locator('[data-forma-status="pending"], [data-forma-status="hydrating"], [data-forma-status="error"]').count(), 0, 'island did not activate after load');
              await assertActivated();
              // Real DOM negative control: the gate must reject the runtime's actual marker.
              await page.evaluate(() => { const el = document.createElement('div'); el.id = 'p17-pending-probe'; el.setAttribute('data-forma-status', 'pending'); document.body.append(el); });
              await assert.rejects(assertActivated, /did not activate/);
              await page.locator('#p17-pending-probe').evaluate(el => el.remove());
              await assertActivated();
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
          });
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
    } finally { await browser.close(); }
    // New contracts must provide their tests before the milestone enables live publication.
    // A2 dry runs deliberately exercise the existing contracts without claiming future coverage.
    if (!set.dryRun) assert.equal(set.contracts.liveReleaseReady, true, 'new milestone contract tests are still pending; nothing may publish');
    report.passed = true;
    report.elapsedSeconds = (Date.now() - started) / 1000;
    save(reportPath, report);
  } finally {
    if (!report.passed) save(reportPath, { ...report, elapsedSeconds: (Date.now() - started) / 1000 });
    // Keep logs/report outside scratch; remove only this invocation's own output.
    rmSync(scratch, { recursive: true, force: true });
    rmSync(cli, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verify(resolve(process.argv[2]), resolve(process.argv[3])).catch(e => { console.error(`P17: ${e.stack}`); process.exitCode = 1; });
