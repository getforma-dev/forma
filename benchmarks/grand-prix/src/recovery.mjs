// Explicit stale-run recovery. A dead CLI alone never proves its worker is dead.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, readJSON, runPath, safePath, verify, writeJSON } from './session.mjs';

function processState(pid, group = false) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) return 'invalid';
  try { process.kill(group ? -pid : pid, 0); return 'alive'; }
  catch (error) { return error.code === 'ESRCH' ? 'dead' : error.code === 'EPERM' ? 'alive' : 'unknown'; }
}
function bytesIfPresent(file) {
  try { return fs.readFileSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function planRecovery(root, { runId } = {}) {
  const dir = runPath(root, runId), lockPath = safePath(root, '.grandprix/active.json');
  const lockBytes = fs.readFileSync(lockPath), lock = JSON.parse(lockBytes);
  const blocked = [];
  if (lock.runId !== runId) blocked.push('The active lock belongs to a different run.');
  if (lock.hostname !== os.hostname()) blocked.push('Only an interrupted run from this host can be recovered here.');
  const ownerState = processState(lock.pid);
  if (ownerState !== 'dead') blocked.push(`The lock owner PID is ${ownerState}; it cannot be recovered.`);
  if (!['run', 'cleanup'].includes(lock.operation)) blocked.push('This lock does not identify a recoverable run/cleanup operation. Updates require separate source reconciliation.');
  if (lock.operation === 'run') {
    if (!['preflight', 'running', 'finishing'].includes(lock.phase)) blocked.push('The worker launch phase is unresolved; a surviving worker cannot be ruled out.');
    if (lock.phase === 'running' && processState(lock.workerPid) === 'invalid') blocked.push('A running phase requires its recorded worker PID.');
  }
  const workerState = lock.workerPid === undefined || lock.workerPid === null ? 'not-recorded' : processState(lock.workerPid);
  if (!['dead', 'not-recorded'].includes(workerState)) blocked.push(`The recorded worker PID is ${workerState}; it cannot be recovered.`);
  const groupState = lock.workerProcessGroup === undefined || lock.workerProcessGroup === null ? 'not-recorded'
    : process.platform === 'win32' ? 'unknown' : processState(lock.workerProcessGroup, true);
  if (lock.operation === 'run' && ['running', 'finishing'].includes(lock.phase) && workerState !== 'not-recorded') {
    if (groupState === 'not-recorded') blocked.push('The worker process group was not recorded; surviving descendants cannot be ruled out.');
    else if (lock.workerProcessGroup !== lock.workerPid) blocked.push('The worker process group does not match its detached leader.');
  }
  if (!['dead', 'not-recorded'].includes(groupState)) blocked.push(`The recorded worker process group is ${groupState}; surviving descendants cannot be ruled out.`);
  const manifestFile = safePath(root, path.join('runs', runId, 'manifest.json'));
  const manifestBytes = bytesIfPresent(manifestFile);
  let manifest = null;
  if (manifestBytes) {
    try { manifest = JSON.parse(manifestBytes); }
    catch { blocked.push('The run manifest is malformed; preserve it for manual inspection.'); }
    if (manifest && (manifest.id ?? manifest.runId) !== runId) blocked.push('The run manifest belongs to a different run.');
  } else if (lock.operation !== 'run' || lock.phase !== 'preflight') blocked.push('A missing manifest is recoverable only before worker launch.');
  let integrityBefore = null;
  if (fs.existsSync(safePath(root, path.join('runs', runId, 'integrity.json')))) {
    try { integrityBefore = verify(dir); }
    catch (error) { integrityBefore = { ok: false, problems: [error.message] }; }
  }
  return { schemaVersion: 1, root: path.resolve(root), runId, lock, ownerState, workerState, groupState,
    lockSha256: hash(lockBytes), manifestSha256: manifestBytes ? hash(manifestBytes) : null,
    manifestStatus: manifest?.status ?? null, integrityBefore, blocked,
    actions: ['Preserve the original lock and manifest in a recovery receipt.',
      'Mark the interrupted lifecycle unqualified; retain every raw observation.',
      'Release only this proven-dead run lock. Docker resources remain untouched.',
      `Inspect npm run gp -- cleanup ${runId} --docker before applying any Docker cleanup.`] };
}
export function applyRecovery(root, plan) {
  assert.equal(plan.schemaVersion, 1); assert.equal(plan.root, path.resolve(root), 'recovery belongs to another laboratory');
  assert.equal(plan.blocked.length, 0, plan.blocked.join(' '));
  const fresh = planRecovery(root, { runId: plan.runId });
  assert.equal(fresh.blocked.length, 0, fresh.blocked.join(' '));
  for (const key of ['lockSha256', 'manifestSha256']) assert.equal(fresh[key], plan[key], 'recovery plan changed; inspect a fresh plan');
  // Keep active.json in place until the evidence is durable. This separate guard
  // prevents two recovery commands from racing to release a newly acquired lock.
  const guardPath = safePath(root, '.grandprix/recovery.json'), token = randomUUID();
  try { writeJSON(guardPath, { operation: 'recovery', pid: process.pid, hostname: os.hostname(), runId: plan.runId, token }, true); }
  catch (error) { if (error.code === 'EEXIST') throw Error('A recovery guard already exists. Inspect .grandprix/recovery.json; concurrent or interrupted recovery is never overwritten.'); throw error; }
  try {
    const checked = planRecovery(root, { runId: plan.runId });
    assert.equal(checked.blocked.length, 0, checked.blocked.join(' '));
    assert.equal(checked.lockSha256, plan.lockSha256, 'active lock changed during recovery');
    assert.equal(checked.manifestSha256, plan.manifestSha256, 'manifest changed during recovery');
    const dir = runPath(root, plan.runId);
    fs.mkdirSync(dir, { recursive: true });
    const manifestFile = safePath(dir, 'manifest.json');
    const previous = fs.existsSync(manifestFile) ? readJSON(manifestFile) : null;
    const at = new Date().toISOString();
    const receiptPath = safePath(dir, path.join('recovery', `${at.replace(/[:.]/g, '-')}-${token}.json`));
    const receipt = { schemaVersion: 1, runId: plan.runId, recoveredAt: at, lockBefore: checked.lock,
      manifestBefore: previous, integrityBefore: checked.integrityBefore, completed: false,
      dockerCleanup: 'Not performed. Inspect the explicit run-owned cleanup plan before applying it.' };
    writeJSON(receiptPath, receipt, true);
    const manifest = previous ?? { schemaVersion: 1, id: plan.runId, startedAt: checked.lock.startedAt,
      source: null, expected: [], mode: 'diagnostic', error: 'Owner exited before a run manifest was saved; no measurement provenance is available.' };
    manifest.status = 'interrupted'; manifest.quality = 'unqualified'; manifest.finishedAt = at;
    manifest.recovery = { receipt: path.relative(dir, receiptPath), operation: checked.lock.operation,
      reason: 'Recorded owner, worker and tracked worker process group are no longer running on this host.',
      priorIntegrity: checked.integrityBefore?.ok ?? null, evidenceRequiresReview: true };
    writeJSON(manifestFile, manifest);
    const lockPath = safePath(root, '.grandprix/active.json');
    assert.equal(hash(fs.readFileSync(lockPath)), plan.lockSha256, 'active lock changed before release');
    // No other compliant runner can start while the original active lock exists.
    fs.unlinkSync(lockPath);
    receipt.completed = true; writeJSON(receiptPath, receipt);
    return { runId: plan.runId, status: manifest.status, quality: manifest.quality, receiptPath,
      dockerCleanupRequired: true, evidenceRequiresReview: true };
  } finally {
    if (fs.existsSync(guardPath) && readJSON(guardPath).token === token) fs.unlinkSync(guardPath);
  }
}
