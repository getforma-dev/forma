// The only new concurrency is two independent lanes. Every later timing/Cargo
// stage is held behind this complete join. Linux owns detached grandchildren
// through the existing, unchanged release subreaper; other platforms use check.sh.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnProofProcess, stopProofProcess } from './router-proof-process.mjs';
import { ROOT } from './check-core-partition.mjs';
import { assertAdmissionUnchanged, inputsFile, planFile } from './check-scheduler-admission.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function freshEvidencePath(destination, root = ROOT) {
  assert(isAbsolute(destination), 'evidence must be an absolute path');
  const normalized = resolve(destination);
  // Require an existing parent and resolve symlinks before comparing identities.
  // Root Playwright deletes its output directory, so lexical prefixes are unsafe.
  const physical = resolve(realpathSync(dirname(normalized)), basename(normalized));
  const inside = relative(realpathSync(root), physical);
  assert(inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside), 'evidence must be outside the source checkout');
  assert.throws(() => lstatSync(physical), { code: 'ENOENT' }, 'evidence directory must be fresh');
  return physical;
}
export function seal(root, paths) {
  const rows = [];
  const visit = name => {
    const path = resolve(root, name), info = lstatSync(path);
    if (info.isSymbolicLink()) rows.push({ path: name, link: readlinkSync(path) });
    else if (info.isDirectory()) for (const entry of readdirSync(path).sort()) visit(`${name}/${entry}`);
    else { assert(info.isFile(), `unsupported sealed input ${name}`); rows.push({ path: name, bytes: info.size, mode: info.mode & 0o777, sha256: hash(readFileSync(path)) }); }
  };
  for (const path of [...new Set(paths)].sort()) visit(path);
  assert(rows.length > 0, 'empty input seal');
  return rows;
}
export function assertSeal(root, paths, before) {
  assert.deepEqual(seal(root, paths), before, 'shared source/product changed across concurrent lanes');
}

export async function runPair({ specs, start, verifyInputs, save, signal }) {
  assert.equal(specs.length, 2);
  assert.equal(new Set(specs.map(spec => spec.id)).size, 2);
  assert(specs.every(spec => spec.cargoPools === 0), 'Cargo work must remain exclusive');
  assert(specs.reduce((n, spec) => n + spec.browserWorkers, 0) <= 2, 'global browser admission exceeds two');
  const record = { complete: false, interrupted: false, lanes: specs.map(spec => ({ ...spec, status: 'not-started' })), faults: [] };
  const live = new Map();
  let refused = false;
  const cancel = reason => {
    refused = true;
    for (const [id, job] of live) {
      record.lanes.find(lane => lane.id === id).cancelRequested ??= reason;
      try { job.cancel(); } catch (error) { record.faults.push(`cancel ${id}: ${error.message}`); }
    }
  };
  const interrupted = () => { record.interrupted = true; cancel('external cancellation'); };
  signal?.addEventListener('abort', interrupted, { once: true });
  try {
    verifyInputs();
    await save(record); // No child starts if the initial evidence write fails.
    if (signal?.aborted) interrupted();
    const waits = specs.map(async (spec, index) => {
      const row = record.lanes[index];
      if (refused) return;
      try {
        row.startedAt = new Date().toISOString();
        const job = start(spec);
        live.set(spec.id, job);
        row.status = 'running';
        row.outcome = await job.closed;
        assert.equal(row.outcome.complete, true, `${spec.id} command/log/cleanup failed`);
        row.status = 'passed';
      } catch (error) {
        row.status = 'failed'; row.error = error.message;
        cancel(`${spec.id} failed`);
      } finally {
        live.delete(spec.id);
        row.finishedAt = new Date().toISOString();
      }
    });
    await Promise.allSettled(waits); // Always join both; never last-wait status only.
    verifyInputs();
    record.complete = !refused && !record.interrupted && record.lanes.every(row => row.status === 'passed') && record.faults.length === 0;
  } catch (error) {
    record.faults.push(error.message); cancel('scheduler failure');
    // start() cannot return an unregistered running child: its contract requires
    // a handle before any asynchronous failure. Join all already-owned handles.
    await Promise.allSettled([...live.values()].map(job => job.closed));
  } finally {
    signal?.removeEventListener('abort', interrupted);
    await save(record); // Failure to retain the final record also fails the caller.
  }
  return record;
}

export function ownedCommand(command, directory, seconds, cwd = ROOT) {
  const descriptor = openSync(`${directory}-owner.log`, 'wx');
  let handle;
  try { handle = spawnProofProcess('python3', [resolve(ROOT, 'scripts/release-owned-linux.py'), directory, String(seconds), '--', ...command], { cwd, env: process.env }); }
  catch (error) { closeSync(descriptor); throw error; }
  let logError;
  const cancel = () => { if (!handle.ended && handle.child.pid) handle.child.kill('SIGTERM'); };
  const collect = bytes => {
    try { assert.equal(writeSync(descriptor, bytes), bytes.length, 'short owner-log write'); }
    catch (error) { logError ??= error; cancel(); }
  };
  handle.child.stdout.on('data', collect); handle.child.stderr.on('data', collect);
  const closed = (async () => {
    const result = await handle.closed;
    let group;
    try { group = await stopProofProcess(handle, { graceMs: 20_000, killMs: 5_000 }); }
    finally { try { closeSync(descriptor); } catch (error) { logError ??= error; } }
    const owner = JSON.parse(readFileSync(resolve(directory, 'supervisor.json'), 'utf8'));
    assert.deepEqual(owner.command, command, 'subreaper command identity differs');
    return { complete: result.code === 0 && !result.signal && !result.error && !logError && owner.complete === true
      && owner.exitCode === 0 && owner.cleanup.complete === true && owner.cleanup.remainingOwnedPids.length === 0,
    commandExit: result, logError: logError?.message ?? null, outerGroup: group, owner };
  })();
  return { cancel, closed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--evidence-path') {
    assert.equal(process.argv.length, 4);
    console.log(freshEvidencePath(process.argv[3]));
    process.exit(0);
  }
  assert.equal(process.platform, 'linux', 'overlap is Linux-only; other contexts use the complete serial plan');
  const [destination, epoch] = process.argv.slice(2);
  assert(destination && /^\d+$/.test(epoch ?? ''));
  const evidence = freshEvidencePath(destination), started = Number(epoch);
  const admission = assertAdmissionUnchanged(resolve(evidence, '..'));
  mkdirSync(evidence); // Evidence must be fresh and outside root Playwright output.
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean);
  const products = ['packages/core/dist', 'packages/compiler/dist', 'packages/build/dist', 'packages/router/dist',
    'packages/core/e2e/fixtures', 'e2e/fixtures/formajs-runtime.global.js', 'e2e/fixtures/formajs.global.js',
    'e2e/ssr/out', 'e2e/frame/out', 'e2e/skew/out'];
  // Fixture-app test rebuilds are B-owned. CLI dist, npm tarballs/caches,
  // expression/hostile reports, Vitest caches and unique scratch are not shared
  // immutable inputs. Their writers are recorded separately in the ownership map.
  const paths = [...tracked, ...products, ...admission.inputs.map(row => row.path), inputsFile, planFile];
  const before = seal(ROOT, paths);
  writeFileSync(resolve(evidence, 'input-seal.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try {
    const remaining = 1500 - (Math.floor(Date.now() / 1000) - started);
    assert(remaining > 0, 'existing 25-minute CI job envelope exhausted');
    const record = await runPair({ specs: [{ id: 'a', browserWorkers: 0, cargoPools: 0 }, { id: 'b', browserWorkers: 2, cargoPools: 0 }],
      start: spec => ownedCommand(['bash', resolve(ROOT, 'scripts/check-scheduler-lanes.sh'), spec.id, String(started), resolve(evidence, '..')], resolve(evidence, spec.id), remaining), signal: controller.signal,
      verifyInputs: () => { assertAdmissionUnchanged(resolve(evidence, '..')); assertSeal(ROOT, paths, before); },
      save: value => writeFileSync(resolve(evidence, 'join.json'), JSON.stringify(value, null, 2) + '\n') });
    assert(record.complete, `concurrent check refused; retained ${evidence}/join.json`);
    console.log(`Both R17 lanes and owned cleanup passed; retained ${evidence}`);
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
