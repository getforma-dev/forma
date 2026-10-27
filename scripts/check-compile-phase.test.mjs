// Bounded compile scheduling/receipt controls. No Cargo, browser or real build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileSpecs, buildPackages, compileCommands, productSeal, validateCompileReceipt, consumeCompileReceipt } from './check-compile-phase.mjs';
import { runCompilePair, runPair } from './check-scheduler-pair.mjs';
import { validatePlan } from './check-scheduler-admission.mjs';
import { ROOT } from './check-core-partition.mjs';
import { spawnProofProcess, stopProofProcess } from './router-proof-process.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function receiptFixture(run) {
  const directory = mkdtempSync(resolve(tmpdir(), 'forma-compile-receipt-'));
  const commands = compileCommands(directory, 42, '/synthetic/source');
  const join = { complete: true, interrupted: false, faults: [], lanes: compileSpecs.map(spec => ({ ...spec, status: 'passed',
    outcome: { complete: true, commandExit: { code: 0, signal: null }, outerGroup: { processGroupGone: true },
      owner: { command: commands[spec.id], complete: true, exitCode: 0, faults: [], cleanup: { complete: true, remainingOwnedPids: [] } } } })) };
  const expected = { directory, root: '/synthetic/source', admissionDirectory: '/synthetic/admission',
    admissionSha256: hash('fresh admission'), sourceSealSha256: hash('all source'), productsSha256: hash('all output bytes'), joinSha256: hash(JSON.stringify(join)),
    parent: { pid: 42, startTime: '123456' }, commands, join };
  const receipt = { schema: 1, complete: true, ...expected, cargoBuildJobs: 3, packages: buildPackages }; delete receipt.join;
  try { run({ directory, expected, receipt }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('compile plan contains all original work once and joins before Rust runtime guards', () => {
  const plan = validatePlan();
  assert.deepEqual(plan.compileCargo, ['s05', 's06', 's09', 's10']);
  assert.deepEqual(plan.compileNpm, ['s00', 's01', 's02', 's03', 's04', 's11']);
  assert.deepEqual(plan.beforeFork.slice(0, 2), ['s07', 's08']);
  for (const id of ['s07', 's08']) {
    const altered = structuredClone(plan); altered.beforeFork = altered.beforeFork.filter(value => value !== id); altered.compileCargo.push(id);
    assert.throws(() => validatePlan(ROOT, altered));
  }
  const stages = readFileSync(resolve(ROOT, 'scripts/check-stages.sh'), 'utf8');
  const body = stages.slice(stages.indexOf('    s11)'), stages.indexOf('    s12)'));
  assert.deepEqual([...body.matchAll(/forma_check_build_package (packages\/\S+) /g)].map(row => row[1]), buildPackages);
  const helper = readFileSync(resolve(ROOT, 'scripts/check-builds.sh'), 'utf8');
  assert(helper.includes(`for package_dir in ${buildPackages.join(' ')}; do`));
});

test('receipt transfer refuses other invocations, altered bindings, failed cleanup and replay', () => receiptFixture(({ directory, expected, receipt }) => {
  validateCompileReceipt(receipt, expected);
  for (const key of ['directory', 'root', 'admissionDirectory', 'admissionSha256', 'sourceSealSha256', 'productsSha256', 'joinSha256']) {
    const altered = structuredClone(receipt); altered[key] += '-changed'; assert.throws(() => validateCompileReceipt(altered, expected), undefined, key);
  }
  for (const change of [value => value.parent.pid++, value => value.parent.startTime += '1', value => value.packages.reverse(),
    value => value.commands.npm.push('unreviewed command'), value => value.complete = false]) {
    const altered = structuredClone(receipt); change(altered); assert.throws(() => validateCompileReceipt(altered, expected));
  }
  for (const change of [join => join.complete = false, join => join.interrupted = true, join => join.faults.push('log refused'),
    join => join.lanes[0].outcome.owner.cleanup.remainingOwnedPids.push(123), join => join.lanes[1].outcome.logError = 'write failed',
    join => join.lanes[1].outcome.commandExit.code = 9, join => join.lanes[0].outcome.outerGroup.processGroupGone = false,
    join => join.lanes[0].outcome.owner.faults.push('producer left live descendants')]) {
    const altered = structuredClone(expected); change(altered.join); assert.throws(() => validateCompileReceipt(receipt, altered));
  }
  writeFileSync(resolve(directory, 'build-receipt.json'), JSON.stringify({ ...receipt, complete: false }));
  assert.throws(() => consumeCompileReceipt(directory, expected)); assert.equal(existsSync(resolve(directory, 'imported.json')), false);
  writeFileSync(resolve(directory, 'build-receipt.json'), JSON.stringify(receipt)); consumeCompileReceipt(directory, expected);
  assert.throws(() => consumeCompileReceipt(directory, expected), /EEXIST/);
}));

test('complete product seal observes every chunk, missing output and external aliases', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'forma-compile-products-'));
  try {
    for (const pkg of buildPackages) { mkdirSync(resolve(root, pkg, 'dist'), { recursive: true }); writeFileSync(resolve(root, pkg, 'dist/index.js'), pkg); }
    const before = productSeal(root); assert.equal(before.length, 5);
    const extra = resolve(root, 'packages/core/dist/new-chunk.js'); writeFileSync(extra, 'new bytes');
    assert.notDeepEqual(productSeal(root), before); rmSync(extra);
    const index = resolve(root, 'packages/router/dist/index.js'); writeFileSync(index, 'changed bytes'); assert.notDeepEqual(productSeal(root), before);
    rmSync(index); assert.throws(() => productSeal(root), /every package/);
    symlinkSync(resolve(root, 'packages/core/dist/index.js'), index); assert.throws(() => productSeal(root), /symlinks/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function children(programs, handles) {
  return spec => {
    const handle = spawnProofProcess(process.execPath, ['-e', programs[spec.id]]); handles.push(handle);
    handle.child.stdout.resume(); handle.child.stderr.resume(); let stopping;
    const stop = () => stopping ??= stopProofProcess(handle, { graceMs: 100, killMs: 3000 });
    return { cancel() { void stop().catch(() => {}); }, closed: (async () => {
      const result = await handle.closed; const cleanup = await stop();
      return { complete: result.code === 0 && result.signal === null && !result.error, result, cleanup };
    })() };
  };
}
test('compile-specific resource boundary does not weaken the later Cargo-free pair', async () => {
  await assert.rejects(runPair({ specs: compileSpecs }), /Cargo work must remain exclusive/);
  for (const changed of [[{ ...compileSpecs[0], cargoPools: 2 }, compileSpecs[1]], [compileSpecs[0], { ...compileSpecs[1], browserWorkers: 1 }],
    [compileSpecs[0], { ...compileSpecs[1], cargoPools: 1 }]]) await assert.rejects(runCompilePair({ specs: changed }), /compile phase/);
});
test('either compile producer failure cancels and joins its peer before return', async () => {
  for (const failed of ['cargo', 'npm']) {
    const handles = [], programs = { cargo: 'setInterval(()=>{},1000)', npm: 'setInterval(()=>{},1000)' }; programs[failed] = 'process.exit(17)';
    const record = await runCompilePair({ specs: compileSpecs, start: children(programs, handles), verifyInputs() {}, save() {} });
    assert.equal(record.complete, false); assert.equal(record.lanes.find(row => row.id === failed).outcome.result.code, 17);
    assert(handles.every(handle => handle.ended && (process.platform === 'win32' || handle.groupStopped)));
  }
});
test('compile interrupt, source drift, logging and launch refusal retain failure without advancing', async () => {
  const handles = [], controller = new AbortController();
  const pending = runCompilePair({ specs: compileSpecs, start: children({ cargo: 'setInterval(()=>{},1000)', npm: 'setInterval(()=>{},1000)' }, handles),
    signal: controller.signal, verifyInputs() {}, save() {} });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const interrupted = await pending; assert.equal(interrupted.complete, false); assert.equal(interrupted.interrupted, true); assert(handles.every(handle => handle.ended));
  let checks = 0;
  const drift = await runCompilePair({ specs: compileSpecs, start: () => ({ cancel() {}, closed: Promise.resolve({ complete: true }) }),
    verifyInputs() { if (++checks === 2) throw Error('source changed'); }, save() {} });
  assert.equal(drift.complete, false); assert.deepEqual(drift.faults, ['source changed']);
  const log = await runCompilePair({ specs: compileSpecs, start: () => ({ cancel() {}, closed: Promise.resolve({ complete: false, logError: 'refused' }) }), verifyInputs() {}, save() {} });
  assert.equal(log.complete, false);
  await assert.rejects(runCompilePair({ specs: compileSpecs, start() { throw Error('must not start'); }, verifyInputs() {}, save() { throw Error('cannot retain record'); } }), /cannot retain/);
  const launch = await runCompilePair({ specs: compileSpecs, start() { throw Error('launch refused'); }, verifyInputs() {}, save() {} });
  assert.equal(launch.complete, false); assert.equal(launch.lanes[1].status, 'not-started');
});
