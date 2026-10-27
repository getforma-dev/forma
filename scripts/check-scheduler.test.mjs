// Bounded controls only: no original browser, Cargo, benchmark or unit workload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { validatePartition, validatePrototypeSource, partitionCommands, ROOT, manifestPath } from './check-core-partition.mjs';
import { runPair, seal, assertSeal, freshEvidencePath } from './check-scheduler-pair.mjs';
import { spawnProofProcess, stopProofProcess } from './router-proof-process.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const specs = [{ id: 'a', browserWorkers: 0, cargoPools: 0 }, { id: 'b', browserWorkers: 2, cargoPools: 0 }];
const inventory = JSON.parse(readFileSync(manifestPath));
test('all original core files are unchanged and dispatched once, with timing/heap/Cargo exclusive', () => {
  validatePrototypeSource();
  validatePartition();
  assert.deepEqual(Object.values(inventory.groups).map(rows => rows.length), [245, 35]);
  for (const kind of ['unit', 'browser']) {
    const commands = ['overlap', 'exclusive'].flatMap(phase => partitionCommands(kind, phase, ROOT, inventory, `/tmp/unused-${phase}`));
    assert.deepEqual(commands.flatMap(command => command.files).sort(), inventory.groups[kind].map(row => row.file).sort());
    assert.equal(new Set(commands.flatMap(command => command.files)).size, inventory.groups[kind].length);
    assert.deepEqual(commands.slice(1).map(command => command.files.length), kind === 'unit' ? [1, 1] : [1, 1, 1]);
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
test('whole-command source coverage retains every original stage and explicit partition replacements', () => {
  const original = readFileSync(resolve(ROOT, 'scripts/check.sh'), 'utf8');
  const expected = JSON.parse(readFileSync(resolve(ROOT, 'scripts/check-scheduler-workload.json')));
  assert.equal(digest(original), expected.originalScriptSha256, 'review the changed original workload before regenerating the prototype');
  const prototype = readFileSync(resolve(ROOT, 'scripts/check-scheduler-prototype.sh'), 'utf8');
  const lanes = readFileSync(resolve(ROOT, 'scripts/check-scheduler-lanes.sh'), 'utf8');
  const all = prototype + '\n' + lanes;
  const markers = [...original.matchAll(/^step "[^\n]+"$/gm)];
  assert.equal(markers.length, 32);
  const once = text => assert.equal(all.split(text.trim()).length - 1, 1, `original block must occur once: ${text.slice(0, 110)}`);
  for (let index = 0; index < markers.length; index++) {
    let block = original.slice(markers[index].index, markers[index + 1]?.index ?? original.length);
    if (index === 12) continue;
    if (index === 15) block = block.replace('node --test scripts/release-integrity.test.mjs\n', '');
    if (index === 25) block = block.replace('npm run test:browser -w packages/build\n', '')
      .replace("npx playwright test --grep-invert 'indexed products: complete public set'", "npx playwright test --workers=2 --grep-invert 'indexed products: complete public set'")
      .replace('(source scripts/check-core-browser.sh --project=chromium)', 'node scripts/check-core-partition.mjs browser overlap "$scheduler_evidence/core-overlap"');
    once(block);
  }
  for (const command of ['node --test scripts/release-integrity.test.mjs', 'npm run test:browser -w packages/build',
    'node scripts/check-core-partition.mjs unit overlap', 'node scripts/check-core-partition.mjs unit exclusive',
    'node scripts/check-core-partition.mjs browser exclusive',
    'npm test -w packages/router -w packages/compiler -w packages/build -w packages/create-app',
    "node -e \"require('fs').copyFileSync('dist/formajs-runtime.global.js','e2e/fixtures/formajs-runtime.global.js')\""]) once(command);
  assert.deepEqual(JSON.parse(readFileSync(resolve(ROOT, 'package.json'))).workspaces,
    ['packages/core', 'packages/router', 'packages/compiler', 'packages/build', 'packages/create-app']);
  assert(prototype.indexOf('node scripts/check-scheduler-pair.mjs') < prototype.indexOf('unit exclusive'));
  assert(prototype.indexOf('browser exclusive') < prototype.indexOf('node scripts/run-router-native-proof.mjs'));
  assert(prototype.indexOf('node e2e/value-rules/run.mjs') < prototype.indexOf('N3: actual indexed'));
  assert(prototype.includes('exec bash scripts/check.sh'), 'portable/optional-heavy fallback absent');
});
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
