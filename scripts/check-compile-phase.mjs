// Linux-only compile overlap. Every timing test follows the complete join.
// Transfer a single current invocation's verified build products, never a
// persistent cache, exported skip flag, or executable receipt.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './check-core-partition.mjs';
import { assertAdmissionUnchanged, inputsFile, planFile } from './check-scheduler-admission.mjs';
import { seal, assertSeal, freshEvidencePath, ownedCommand, runCompilePair } from './check-scheduler-pair.mjs';

export const compileSpecs = [
  { id: 'cargo', browserWorkers: 0, cargoPools: 1 },
  { id: 'npm', browserWorkers: 0, cargoPools: 0 },
];
export const buildPackages = ['packages/compiler', 'packages/build', 'packages/core', 'packages/router', 'packages/create-app'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

export function parentIdentity(pid = process.ppid) {
  assert(Number.isInteger(pid) && pid > 0, 'compile transfer requires the original live parent');
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  // comm may contain spaces or parentheses; starttime is field22, after comm.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  assert(!['Z', 'X', 'x'].includes(fields[0]), 'original compile parent is no longer live');
  assert(/^\d+$/.test(fields[19] ?? ''), 'parent start identity missing');
  return { pid, startTime: fields[19] };
}

export function compileCommands(directory, started, root = ROOT) {
  return Object.fromEntries(['cargo', 'npm'].map(id => [id,
    ['bash', resolve(root, 'scripts/check-scheduler-lanes.sh'), id === 'cargo' ? 'compileCargo' : 'compileNpm', String(started), dirname(directory)]]));
}

export function sourcePaths(admission, root = ROOT) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  return [...new Set([...tracked, ...admission.inputs.map(row => row.path), inputsFile, planFile])].sort();
}

export function productSeal(root = ROOT) {
  const rows = seal(root, buildPackages.map(path => `${path}/dist`));
  assert(rows.every(row => !Object.hasOwn(row, 'link')), 'compile products may not alias mutable files through symlinks');
  assert(buildPackages.every(path => rows.some(row => row.path.startsWith(`${path}/dist/`))), 'every package needs actual output bytes');
  return rows;
}

export function assertCompileJoin(join, commands) {
  assert.equal(join.complete, true, 'both compile producers and cleanup must pass');
  assert.equal(join.interrupted, false); assert.deepEqual(join.faults, []);
  assert.deepEqual(join.lanes.map(({ id, browserWorkers, cargoPools }) => ({ id, browserWorkers, cargoPools })), compileSpecs);
  for (const row of join.lanes) {
    assert.equal(row.status, 'passed'); assert.equal(row.outcome.complete, true);
    assert.equal(row.outcome.commandExit.code, 0); assert.equal(row.outcome.commandExit.signal, null);
    assert(!row.outcome.commandExit.error && !row.outcome.logError, 'compile command/logger failed');
    assert.equal(row.outcome.outerGroup.processGroupGone, true);
    const owner = row.outcome.owner;
    assert.deepEqual(owner.command, commands[row.id]);
    assert.equal(owner.complete, true); assert.equal(owner.exitCode, 0);
    assert.deepEqual(owner.faults, []);
    assert.equal(owner.cleanup.complete, true); assert.deepEqual(owner.cleanup.remainingOwnedPids, []);
  }
}

export function validateCompileReceipt(receipt, expected) {
  assert.equal(receipt.schema, 1); assert.equal(receipt.complete, true);
  assert.equal(receipt.cargoBuildJobs, 3);
  for (const key of ['directory', 'root', 'admissionDirectory', 'admissionSha256', 'sourceSealSha256', 'joinSha256', 'productsSha256'])
    assert.equal(receipt[key], expected[key], `compile receipt ${key} differs`);
  assert.deepEqual(receipt.parent, expected.parent, 'compile receipt belongs to another parent invocation');
  assert.deepEqual(receipt.packages, buildPackages, 'compile receipt package order differs');
  assert.deepEqual(receipt.commands, expected.commands, 'compile receipt commands differ');
  assertCompileJoin(expected.join, expected.commands);
}

// All verification precedes the consumed-once marker. A subsequent shell may
// not replay even an otherwise byte-identical successful old build receipt.
export function consumeCompileReceipt(directory, expected) {
  validateCompileReceipt(read(resolve(directory, 'build-receipt.json')), expected);
  save(resolve(directory, 'imported.json'), { importedAt: new Date().toISOString(), parent: expected.parent,
    admissionSha256: expected.admissionSha256, receiptSha256: hash(readFileSync(resolve(directory, 'build-receipt.json'))) });
}

export function verifyImport(directory, root = ROOT) {
  directory = realpathSync(directory);
  const admissionDirectory = dirname(directory), admission = assertAdmissionUnchanged(admissionDirectory, root);
  assert.equal(resolve(admissionDirectory, 'compile'), directory, 'compile receipt is outside this admission');
  const source = sourcePaths(admission, root), before = read(resolve(directory, 'input-seal.json'));
  assertSeal(root, source, before);
  const products = productSeal(root), recordedProducts = read(resolve(directory, 'products.json'));
  assert.deepEqual(products, recordedProducts, 'current compile output bytes changed before import');
  const join = read(resolve(directory, 'join.json')), receipt = read(resolve(directory, 'build-receipt.json'));
  const commands = compileCommands(directory, receipt.started, root);
  for (const row of join.lanes) {
    assert(['cargo', 'npm'].includes(row.id));
    assert.deepEqual(read(resolve(directory, row.id, 'supervisor.json')), row.outcome?.owner, 'original owner record differs from join');
  }
  consumeCompileReceipt(directory, { directory, root: realpathSync(root), admissionDirectory,
    admissionSha256: hash(readFileSync(resolve(admissionDirectory, 'admission.json'))),
    sourceSealSha256: hash(readFileSync(resolve(directory, 'input-seal.json'))),
    productsSha256: hash(readFileSync(resolve(directory, 'products.json'))),
    joinSha256: hash(readFileSync(resolve(directory, 'join.json'))),
    parent: parentIdentity(), commands, join });
  console.log(`check: imported this invocation's five owned builds; retained ${directory}`);
}

async function compile(directory, started) {
  const admissionDirectory = dirname(directory), admission = assertAdmissionUnchanged(admissionDirectory);
  assert.equal(resolve(admissionDirectory, 'compile'), directory);
  const parent = parentIdentity();
  mkdirSync(directory);
  const paths = sourcePaths(admission), before = seal(ROOT, paths);
  save(resolve(directory, 'input-seal.json'), before);
  const commands = compileCommands(directory, started);
  const controller = new AbortController(), abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  // If the launching shell disappears, no orphan compile pair may keep running.
  const parentWatch = setInterval(() => {
    try { assert.deepEqual(parentIdentity(parent.pid), parent); }
    catch { controller.abort(); }
  }, 250);
  try {
    const remaining = 1500 - (Math.floor(Date.now() / 1000) - started);
    assert(remaining > 0, 'existing 25-minute CI job envelope exhausted');
    const record = await runCompilePair({ specs: compileSpecs, signal: controller.signal,
      start: spec => ownedCommand(commands[spec.id], resolve(directory, spec.id), remaining, ROOT,
        spec.id === 'cargo' ? { ...process.env, CARGO_BUILD_JOBS: '3' } : process.env),
      verifyInputs: () => { assertAdmissionUnchanged(admissionDirectory); assertSeal(ROOT, paths, before); },
      save: value => writeFileSync(resolve(directory, 'join.json'), JSON.stringify(value, null, 2) + '\n') });
    assertCompileJoin(record, commands);
    assert.deepEqual(parentIdentity(parent.pid), parent);
    const products = productSeal(); save(resolve(directory, 'products.json'), products);
    save(resolve(directory, 'build-receipt.json'), { schema: 1, complete: true, directory, root: realpathSync(ROOT),
      admissionDirectory, admissionSha256: hash(readFileSync(resolve(admissionDirectory, 'admission.json'))),
      sourceSealSha256: hash(readFileSync(resolve(directory, 'input-seal.json'))),
      productsSha256: hash(readFileSync(resolve(directory, 'products.json'))),
      joinSha256: hash(readFileSync(resolve(directory, 'join.json'))),
      parent, started, commands, cargoBuildJobs: 3, packages: buildPackages, completedAt: new Date().toISOString() });
    console.log(`Both compile producers and owned cleanup passed; retained ${directory}`);
  } finally {
    clearInterval(parentWatch); process.off('SIGINT', abort); process.off('SIGTERM', abort);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, 'linux', 'compile overlap is Linux-only');
  const [argument, value] = process.argv.slice(2); assert.equal(process.argv.length, 4);
  if (argument === '--verify-import') verifyImport(value);
  else {
    assert(/^\d+$/.test(value), 'compile phase requires the original command clock');
    const directory = freshEvidencePath(argument);
    assert.throws(() => lstatSync(directory), { code: 'ENOENT' });
    await compile(directory, Number(value));
  }
}
