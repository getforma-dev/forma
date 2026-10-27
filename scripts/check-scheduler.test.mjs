// Bounded controls only: no original browser, Cargo, benchmark or unit workload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { validatePartition, partitionCommands, ROOT, manifestPath } from './check-core-partition.mjs';
import { runPair, seal, assertSeal, freshEvidencePath } from './check-scheduler-pair.mjs';
import { spawnProofProcess, stopProofProcess } from './router-proof-process.mjs';
import { spawnSync } from 'node:child_process';
import { knownSetupCache, collectResourceInputs, decideSchedule, validatePlan, assertAdmissionUnchanged, fallbackContext, validateResourceProfiles, ancestorConfigurationRefusals } from './check-scheduler-admission.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const specs = [{ id: 'a', browserWorkers: 0, cargoPools: 0 }, { id: 'b', browserWorkers: 2, cargoPools: 0 }];
const inventory = JSON.parse(readFileSync(manifestPath));
test('only the known regular untracked CI setup cache receives a generated-output classification', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'forma-setup-cache-control-'));
  const cache = 'scripts/__pycache__/prefer-ubuntu-archive.cpython-312.pyc';
  const path = resolve(root, cache);
  try {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'synthetic generated cache');
    assert.equal(knownSetupCache(cache, root), true);
    for (const unknown of ['scripts/__pycache__/new-helper.cpython-312.pyc', 'scripts/__pycache__/prefer-ubuntu-archive.cpython-312.py',
      'scripts/__pycache__/prefer-ubuntu-archive.cpython-312.pyc/source.mjs', 'scripts/__pycache__/prefer-ubuntu-archive.cpython-312.opt-1.pyc',
      'scripts/__pycache__/prefer-ubuntu-archive.pypy312.pyc', 'scripts/__pycache__/README.md', 'scripts/new-helper.py', 'packages/core/src/new.test.ts'])
      assert.equal(knownSetupCache(unknown, root), false);
    assert.equal(knownSetupCache(cache, root, new Set([cache])), false);
    rmSync(path); mkdirSync(path); assert.equal(knownSetupCache(cache, root), false);
    rmSync(path, { recursive: true }); writeFileSync(resolve(root, 'other'), 'unreviewed');
    symlinkSync(resolve(root, 'other'), path); assert.equal(knownSetupCache(cache, root), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('all original core files are unchanged and dispatched once, with timing/heap/Cargo exclusive', () => {
  validatePartition();
  assert(Object.values(inventory.groups).every(rows => rows.length > 0));
  for (const kind of ['unit', 'browser']) {
    const commands = ['overlap', 'exclusive'].flatMap(phase => partitionCommands(kind, phase, ROOT, inventory, `/tmp/unused-${phase}`));
    assert.deepEqual(commands.flatMap(command => command.files).sort(), inventory.groups[kind].map(row => row.file).sort());
    assert.equal(new Set(commands.flatMap(command => command.files)).size, inventory.groups[kind].length);
    assert.deepEqual(commands.slice(1).map(command => command.files.length), inventory.groups[kind].filter(row => row.phase === 'exclusive').map(() => 1));
    if (kind === 'unit') for (const command of commands) assert.deepEqual(command.args.slice(4), command.files);
    if (kind === 'browser') for (const command of commands) for (const [index, file] of command.files.entries()) {
      const filter = new RegExp(command.args[6 + index]);
      const full = resolve(ROOT, 'packages/core', file);
      assert(filter.test(full)); assert(!filter.test(`${full}.extra`)); assert(!filter.test(`prefix${full}`));
    }
  }
  for (const change of ['missing', 'duplicate', 'misclassified', 'unknown']) {
    const altered = structuredClone(inventory);
    if (change === 'missing') altered.groups.browser.pop();
    if (change === 'duplicate') altered.groups.browser.push(altered.groups.browser[0]);
    if (change === 'misclassified') altered.groups.browser.find(row => row.file === 'e2e/sr33.spec.ts').phase = 'overlap';
    if (change === 'unknown') altered.groups.unit[0].phase = 'unreviewed';
    assert.throws(() => validatePartition(ROOT, altered), undefined, change);
  }
});
test('new default-matching Playwright extensions cannot silently escape discovery', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'forma-partition-control-'));
  const fake = { schema: 1, groups: { unit: [], browser: [] } };
  const write = (kind, file, phase) => {
    const path = resolve(root, 'packages/core', file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'unchanged case');
    fake.groups[kind].push({ file, phase, sha256: digest('unchanged case') });
  };
  try {
    for (const file of ['src/dom/__tests__/list-lis.test.ts', 'src/expr/__tests__/native-cost.test.ts']) write('unit', file, 'exclusive');
    write('unit', 'src/ordinary.test.tsx', 'overlap');
    for (const file of ['e2e/expr-cost.spec.ts', 'e2e/sr33.spec.ts', 'e2e/state-roundtrip.spec.ts']) write('browser', file, 'exclusive');
    write('browser', 'e2e/ordinary.spec.ts', 'overlap');
    validatePartition(root, fake);
    for (const extension of ['test.ts', 'spec.tsx', 'test.mjs', 'spec.cjs']) {
      const path = resolve(root, 'packages/core/e2e/new.' + extension);
      writeFileSync(path, 'new case'); assert.throws(() => validatePartition(root, fake), /every original file/); rmSync(path);
    }
    writeFileSync(resolve(root, 'packages/core/e2e/ordinary.spec.ts'), 'changed');
    assert.throws(() => validatePartition(root, fake), /review changed file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('one authoritative catalogue covers the full serial and concurrent schedules exactly once', () => {
  const plan = validatePlan();
  const originalIds = Array.from({ length: 32 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  assert.deepEqual(plan.serial.slice(0, 32), originalIds, 'preserve the existing serial stage sequence');
  const altered = structuredClone(plan); altered.a.push(altered.b[0]); assert.throws(() => validatePlan(ROOT, altered), /two phases/);
  const missing = structuredClone(plan); missing.beforeFork.shift(); assert.throws(() => validatePlan(ROOT, missing), /exactly once/);
  const late = structuredClone(plan); late.beforeFork = late.beforeFork.filter(x => x !== 's15-cargo'); late.a.push('s15-cargo');
  assert.throws(() => validatePlan(ROOT, late));
  const catalogue = readFileSync(resolve(ROOT, 'scripts/check-stages.sh'), 'utf8');
  for (const command of ['node --test scripts/release-integrity.test.mjs', 'npm run test:browser -w packages/build',
    'node packages/core/scripts/qualify-expression-mutation.mjs', 'node packages/core/e2e/hostile-widgets/run.mjs',
    'node scripts/run-router-native-proof.mjs --engines chromium --skip-package-build'])
    assert.equal(catalogue.split(command).length - 1, 1, command);
  assert(!readFileSync(resolve(ROOT, 'scripts/check-scheduler-lanes.sh'), 'utf8').includes('npm test'), 'lane must use shared bodies');
  const workspaces = JSON.parse(readFileSync(resolve(ROOT, 'package.json'))).workspaces;
  assert.deepEqual(workspaces, ['packages/core', 'packages/router', 'packages/compiler', 'packages/build', 'packages/create-app']);
  assert(catalogue.includes('npm test --workspaces'));
  assert(catalogue.includes('npm test -w packages/router -w packages/compiler -w packages/build -w packages/create-app'));
  assert.match(readFileSync(resolve(ROOT, 'packages/router/vitest.config.ts'), 'utf8'), /tests\/\*\*\/\*\.test\.ts/);
  assert(readFileSync(resolve(ROOT, 'packages/router/tests/components.test.ts')).length > 0, 'current Link regressions are in normal discovery');
});

test('a failing intermediate command exits the shared stage before later commands', () => {
  const source = `set -euo pipefail
source scripts/check-stages.sh
step() { :; }
node() { echo controlled-node; return 19; }
ruby() { echo UNREACHED; }
forma_check_stage s15-controls
echo UNREACHED
`;
  const result = spawnSync('bash', ['-c', source], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 19); assert.equal(result.stdout.trim(), 'controlled-node');
  assert(!result.stdout.includes('UNREACHED'));
});

function admissionFixture(run) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'forma-admission-')));
  try {
    assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
    const write = (name, content) => { mkdirSync(dirname(resolve(root, name)), { recursive: true }); writeFileSync(resolve(root, name), content); };
    for (const name of ['scripts/check-stages.sh', 'scripts/check-scheduler-workload.json']) write(name, readFileSync(resolve(ROOT, name)));
    const fake = { schema: 1, groups: { unit: [], browser: [] }, configuration: [] };
    for (const [kind, files] of Object.entries({ unit: ['src/dom/__tests__/list-lis.test.ts', 'src/expr/__tests__/native-cost.test.ts', 'src/ordinary.test.ts'],
      browser: ['e2e/expr-cost.spec.ts', 'e2e/sr33.spec.ts', 'e2e/state-roundtrip.spec.ts', 'e2e/ordinary.spec.ts'] })) {
      for (const file of files) { write(`packages/core/${file}`, 'case'); fake.groups[kind].push({ file, sha256: digest('case'), phase: file.includes('ordinary') ? 'overlap' : 'exclusive' }); }
    }
    write('scripts/check-core-partition.json', JSON.stringify(fake)); write('scripts/transitive-helper.mjs', 'reviewed helper');
    write('package-lock.json', '{}'); write('packages/core/package.json', JSON.stringify({ version: '3.2.0-rc.4' }));
    const manifest = { schema: 2, roots: ['scripts', 'packages/core/src', 'packages/core/e2e'], files: ['package-lock.json', 'packages/core/package.json'], immediateFiles: ['packages/core'], excludePaths: [], excludeTrees: [], generatedDirectoryNames: ['node_modules'], versionFiles: ['package-lock.json', 'packages/core/package.json'], profiles: {} };
    manifest.profiles['3.2.0-rc.4'] = collectResourceInputs(root, manifest);
    write('scripts/check-scheduler-inputs.json', JSON.stringify(manifest));
    run({ root, write, manifest });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('new/changed tests, helper/config/lock inputs visibly select the complete serial plan before work', () => admissionFixture(({ root, write }) => {
  const context = fallbackContext('linux', {}, 4);
  const initial = decideSchedule(root, context); assert.equal(initial.mode, 'linux-overlap');
  for (const [path, value] of [['scripts/new-helper.mjs', 'new'], ['packages/core/e2e/new.test.mjs', 'new'],
    ['packages/core/src/ordinary.test.ts', 'changed'], ['scripts/transitive-helper.mjs', 'changed'], ['package-lock.json', 'changed']]) {
    const name = resolve(root, path); let before; try { before = readFileSync(name); } catch {}
    write(path, value); const result = decideSchedule(root, context);
    assert.equal(result.mode, 'serial', path); assert(result.reasons.length); assert.deepEqual(result.plan.serial, initial.plan.serial);
    if (before) write(path, before); else rmSync(name);
  }
  for (const [platform, env] of [['darwin', {}], ['linux', { FORMA_SCAFFOLD_E2E: '1' }],
    ['linux', { FORMA_LIST_KEY_EVIDENCE: 'evidence' }], ['linux', { FORMA_LIST_KEY_CORE_BUNDLE: 'bundle' }], ['linux', { CARGO_TARGET_DIR: 'target' }],
    ...['FORMAJS_DIR', 'FORMA_DIR', 'FORMA_SCAFFOLD_CLI', 'FORMA_SCAFFOLD_CONTEXT', 'FORMA_SCAFFOLD_TEMPLATES', 'FORMA_SCAFFOLD_REPORT_DIR',
      'FORMA_EMITTER_PROBE_DIR', 'FORMA_TEST_BROWSER_CHANNEL', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'LD_PRELOAD'].map(key => ['linux', { [key]: 'synthetic external override' }])]) {
    const result = decideSchedule(root, fallbackContext(platform, env)); assert.equal(result.mode, 'serial'); assert.deepEqual(result.plan.serial, initial.plan.serial);
    assert(!JSON.stringify(result.context).includes('synthetic external override'), 'record flags, never override contents');
  }
  for (const cpus of [1, 2, 3, 0, null]) {
    const result = decideSchedule(root, fallbackContext('linux', {}, cpus));
    assert.equal(result.mode, 'serial'); assert(result.reasons.some(reason => reason.includes('four available CPUs')));
    assert.deepEqual(result.plan.serial, initial.plan.serial);
  }
  write('notes.md', 'unrelated notes'); assert.equal(decideSchedule(root, context).mode, 'linux-overlap');
  write('scripts/__pycache__/prefer-ubuntu-archive.cpython-312.pyc', 'synthetic cache'); assert.equal(decideSchedule(root, context).mode, 'linux-overlap');
  write('scripts/__pycache__/unknown.cpython-312.pyc', 'unknown'); assert.equal(decideSchedule(root, context).mode, 'serial');
}));

test('missing, ignored-new, symlink and tracked-cache inputs cannot enter overlap', () => admissionFixture(({ root, write }) => {
  const context = fallbackContext('linux', {}, 4), original = readFileSync(resolve(root, 'scripts/transitive-helper.mjs'));
  rmSync(resolve(root, 'scripts/transitive-helper.mjs'));
  assert.equal(decideSchedule(root, context).mode, 'serial');
  write('scripts/transitive-helper.mjs', original);
  write('.gitignore', 'scripts/ignored-helper.mjs\n'); write('scripts/ignored-helper.mjs', 'unreviewed ignored code');
  assert.equal(decideSchedule(root, context).mode, 'serial'); rmSync(resolve(root, 'scripts/ignored-helper.mjs'));
  symlinkSync(resolve(root, 'package-lock.json'), resolve(root, 'scripts/symlink-helper.mjs'));
  assert.equal(decideSchedule(root, context).mode, 'serial'); rmSync(resolve(root, 'scripts/symlink-helper.mjs'));
  const cache = 'scripts/__pycache__/prefer-ubuntu-archive.cpython-312.pyc';
  write(cache, 'synthetic known cache'); assert.equal(decideSchedule(root, context).mode, 'linux-overlap');
  assert.equal(spawnSync('git', ['add', '--', cache], { cwd: root }).status, 0);
  assert.equal(decideSchedule(root, context).mode, 'serial');
}));

test('new package configs and adjacent helpers refuse overlap before any work', () => admissionFixture(({ root, write }) => {
  const context = fallbackContext('linux', {}, 4);
  assert.equal(decideSchedule(root, context).mode, 'linux-overlap');
  for (const path of ['packages/core/tsup.config.ts', 'packages/core/tsup.config.mjs', 'packages/core/local-config-helper.ts', 'packages/core/.babelrc']) {
    write(path, 'inert unreviewed configuration or helper');
    const result = decideSchedule(root, context);
    assert.equal(result.mode, 'serial'); assert(result.reasons.includes(`unreviewed input: ${path}`)); rmSync(resolve(root, path));
  }
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'scripts/check-scheduler-inputs.json')));
  assert.deepEqual([...manifest.immediateFiles].sort(), ['.', 'packages', 'packages/build', 'packages/compiler', 'packages/core', 'packages/create-app', 'packages/router'].sort());
}));

test('external ancestor tsup/TypeScript configuration cannot enter a reviewed overlap', () => {
  const parent = mkdtempSync(resolve(tmpdir(), 'forma-ancestor-control-')), root = resolve(parent, 'source'); mkdirSync(root);
  try {
    for (const name of ['tsup.config.ts', 'tsup.config.cts', 'tsup.config.mjs', 'tsconfig.json']) {
      writeFileSync(resolve(parent, name), 'inert marker');
      assert(ancestorConfigurationRefusals(root).some(reason => reason.endsWith(resolve(parent, name)))); rmSync(resolve(parent, name));
    }
    writeFileSync(resolve(parent, 'package.json'), '{"tsup":{}}');
    assert(ancestorConfigurationRefusals(root).some(reason => reason.endsWith(resolve(parent, 'package.json'))));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('administrative record changes do not assign resources but remain in the per-run source seal', () => admissionFixture(({ root, write, manifest }) => {
  const path = 'scripts/release-contracts.json', context = fallbackContext('linux', {}, 4);
  manifest.excludePaths.push(path); write('scripts/check-scheduler-inputs.json', JSON.stringify(manifest));
  write(path, '{"status":"pending"}'); const before = seal(root, [path]);
  assert.equal(decideSchedule(root, context).mode, 'linux-overlap');
  write(path, '{"status":"done"}'); assert.equal(decideSchedule(root, context).mode, 'linux-overlap');
  assert.throws(() => assertSeal(root, [path], before), /shared source/);
  const actual = JSON.parse(readFileSync(resolve(ROOT, 'scripts/check-scheduler-inputs.json')));
  assert(actual.excludePaths.includes(path));
  assert(!actual.files.some(file => file.endsWith('/README.md')));
}));

test('finite complete version profiles reject mixed graphs, unknown versions and non-version changes', () => admissionFixture(({ root, write, manifest }) => {
  const context = fallbackContext('linux', {}, 4), initial = manifest.profiles['3.2.0-rc.4'];
  const finalCore = JSON.stringify({ version: '3.2.0' }), finalLock = '{"version":"3.2.0"}';
  const future = structuredClone(initial);
  future.find(row => row.path === 'packages/core/package.json').sha256 = digest(finalCore);
  future.find(row => row.path === 'package-lock.json').sha256 = digest(finalLock);
  manifest.profiles['3.2.0'] = future;
  const save = () => write('scripts/check-scheduler-inputs.json', JSON.stringify(manifest)); save();
  validateResourceProfiles(manifest); assert.equal(decideSchedule(root, context).profileVersion, '3.2.0-rc.4');
  write('packages/core/package.json', finalCore); assert.equal(decideSchedule(root, context).mode, 'serial', 'mixed graph must not choose per-file alternatives');
  write('package-lock.json', finalLock); const final = decideSchedule(root, context);
  assert.equal(final.mode, 'linux-overlap'); assert.equal(final.profileVersion, '3.2.0');
  write('packages/core/package.json', JSON.stringify({ version: '3.2.1' })); assert.equal(decideSchedule(root, context).mode, 'serial'); write('packages/core/package.json', finalCore);
  const helper = future.find(row => row.path === 'scripts/transitive-helper.mjs'), before = helper.sha256;
  helper.sha256 = digest('not a version transform'); save(); assert.equal(decideSchedule(root, context).mode, 'serial'); helper.sha256 = before;
  future.pop(); save(); assert.equal(decideSchedule(root, context).mode, 'serial', 'corrupt membership cannot pass');
}));

test('post-admission drift refuses the invocation instead of restarting its serial plan', () => admissionFixture(({ root, write }) => {
  const context = fallbackContext('linux', {}, 4), decision = decideSchedule(root, context);
  assert.equal(decision.mode, 'linux-overlap');
  const evidence = resolve(root, 'evidence'); mkdirSync(evidence);
  write('evidence/admission.json', JSON.stringify(decision));
  assertAdmissionUnchanged(evidence, root, context);
  write('scripts/transitive-helper.mjs', 'late writer');
  assert.throws(() => assertAdmissionUnchanged(evidence, root, context), /changed after start/);
}));

test('missing or changed shared products refuse admission or the join', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'forma-seal-control-'));
  try {
    mkdirSync(resolve(root, 'dist')); writeFileSync(resolve(root, 'dist/runtime.js'), 'fresh');
    const before = seal(root, ['dist']); assertSeal(root, ['dist'], before);
    writeFileSync(resolve(root, 'dist/runtime.js'), 'cross-lane write');
    assert.throws(() => assertSeal(root, ['dist'], before), /shared source/);
    rmSync(resolve(root, 'dist/runtime.js'));
    assert.throws(() => assertSeal(root, ['dist'], before), /shared source|empty input seal/);
    assert.throws(() => seal(root, ['missing-required-product']), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('evidence rejects normalized and symlink aliases into source and existing outputs', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'forma-evidence-path-control-'));
  try {
    const root = resolve(temporary, 'source'); mkdirSync(root);
    const outside = resolve(temporary, 'external'); mkdirSync(outside);
    mkdirSync(resolve(root, 'test-results'));
    symlinkSync(resolve(root, 'test-results'), resolve(outside, 'alias'));
    assert.throws(() => freshEvidencePath(resolve(root, 'test-results/new'), root), /outside/);
    assert.throws(() => freshEvidencePath(`${outside}/../source/test-results/new`, root), /outside/);
    assert.throws(() => freshEvidencePath(resolve(outside, 'alias/new'), root), /outside/);
    assert.throws(() => freshEvidencePath(outside, root), /fresh/);
    assert.equal(freshEvidencePath(resolve(outside, 'new'), root), resolve(realpathSync(outside), 'new'));
    assert.throws(() => freshEvidencePath('relative', root), /absolute/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

function fakeChildren(programs, handles) {
  return spec => {
    const handle = spawnProofProcess(process.execPath, ['-e', programs[spec.id]]);
    handles.push(handle);
    let stdout = '', stderr = '', stopping;
    handle.child.stdout.on('data', bytes => { stdout += bytes; });
    handle.child.stderr.on('data', bytes => { stderr += bytes; });
    const stop = () => stopping ??= stopProofProcess(handle, { graceMs: 100, killMs: 3000 });
    return { cancel() { void stop().catch(() => {}); }, closed: (async () => {
      const result = await handle.closed;
      const cleanup = await stop();
      return { complete: result.code === 0 && result.signal === null && !result.error, result, cleanup, stdout, stderr };
    })() };
  };
}
test('both actual fake children finish and close output before success', async () => {
  const handles = [], saved = [];
  const record = await runPair({ specs, start: fakeChildren({ a: 'console.log("a-tail")', b: 'console.error("b-tail")' }, handles),
    verifyInputs() {}, save: value => saved.push(structuredClone(value)) });
  assert.equal(record.complete, true); assert.equal(saved.length, 2);
  assert.equal(record.lanes[0].outcome.stdout, 'a-tail\n'); assert.equal(record.lanes[1].outcome.stderr, 'b-tail\n');
  assert(handles.every(handle => handle.ended && (process.platform === 'win32' || handle.groupStopped)));
});
test('a real failed fake child cancels its peer and all statuses remain retained', async () => {
  const handles = [];
  const record = await runPair({ specs, start: fakeChildren({ a: 'process.exit(7)', b: 'setInterval(()=>{},1000)' }, handles), verifyInputs() {}, save() {} });
  assert.equal(record.complete, false); assert.equal(record.lanes[0].outcome.result.code, 7);
  assert.equal(record.lanes[1].cancelRequested, 'a failed'); assert(record.lanes.every(row => row.status === 'failed'));
  assert(handles.every(handle => handle.ended && (process.platform === 'win32' || handle.groupStopped)));
});
test('launch refusal, evidence failure, cancellation and resource refusal never permit a successful join', async () => {
  let starts = 0;
  const refused = await runPair({ specs, start() { starts++; throw Error('launch refused'); }, verifyInputs() {}, save() {} });
  assert.equal(starts, 1); assert.equal(refused.complete, false); assert.equal(refused.lanes[1].status, 'not-started');
  await assert.rejects(runPair({ specs, start() { throw Error('must not start'); }, verifyInputs() {}, save() { throw Error('disk failure'); } }), /disk failure/);
  const handles = [], controller = new AbortController();
  const pending = runPair({ specs, start: fakeChildren({ a: 'setInterval(()=>{},1000)', b: 'setInterval(()=>{},1000)' }, handles), verifyInputs() {}, save() {}, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const cancelled = await pending; assert.equal(cancelled.complete, false); assert.equal(cancelled.interrupted, true);
  assert(handles.every(handle => handle.ended));
  for (const changed of [[{ ...specs[0], cargoPools: 1 }, specs[1]], [{ ...specs[0], browserWorkers: 1 }, specs[1]]])
    await assert.rejects(runPair({ specs: changed, start() { throw Error('must not start'); } }));
});
test('a post-run shared-input write or logging refusal cannot be hidden by two zero child exits', async () => {
  let checks = 0;
  const record = await runPair({ specs, start: () => ({ cancel() {}, closed: Promise.resolve({ complete: true }) }), verifyInputs() { if (++checks === 2) throw Error('shared write'); }, save() {} });
  assert.equal(record.complete, false); assert.deepEqual(record.faults, ['shared write']);
  const outputFailure = await runPair({ specs, start: () => ({ cancel() {}, closed: Promise.resolve({ complete: false, exitCode: 0, logError: 'write failed' }) }), verifyInputs() {}, save() {} });
  assert.equal(outputFailure.complete, false);
});
