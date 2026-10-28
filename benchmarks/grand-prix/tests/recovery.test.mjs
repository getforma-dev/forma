import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { planRecovery, applyRecovery } from '../src/recovery.mjs';

function fixture(t, changes = {}, manifest = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  const lock = { runId: 'orphan', pid: dead, hostname: os.hostname(), operation: 'run', phase: 'preflight', startedAt: new Date().toISOString(), ...changes };
  fs.mkdirSync(path.join(root, '.grandprix'));
  fs.writeFileSync(path.join(root, '.grandprix/active.json'), JSON.stringify(lock));
  if (manifest) {
    fs.mkdirSync(path.join(root, 'runs/orphan/raw'), { recursive: true });
    fs.writeFileSync(path.join(root, 'runs/orphan/manifest.json'), JSON.stringify({ id: 'orphan', status: 'running', quality: 'qualification-pending' }));
    fs.writeFileSync(path.join(root, 'runs/orphan/raw/partial.json'), 'retained unchanged');
  }
  return { root, lock };
}
test('preview does not change a dead same-host run; explicit apply preserves raw and original lock', t => {
  const { root, lock } = fixture(t);
  const plan = planRecovery(root, { runId: 'orphan' }); assert.deepEqual(plan.blocked, []);
  assert(fs.existsSync(path.join(root, '.grandprix/active.json')));
  const result = applyRecovery(root, plan);
  assert.equal(result.status, 'interrupted'); assert.equal(result.quality, 'unqualified');
  assert.equal(fs.readFileSync(path.join(root, 'runs/orphan/raw/partial.json'), 'utf8'), 'retained unchanged');
  assert(!fs.existsSync(path.join(root, '.grandprix/active.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(result.receiptPath)).lockBefore, lock);
  assert.equal(JSON.parse(fs.readFileSync(result.receiptPath)).dockerCleanup.startsWith('Not performed.'), true);
});
for (const [name, changes] of [
  ['live owner', { pid: process.pid }],
  ['live worker', { phase: 'running', workerPid: process.pid }],
  ['foreign host', { hostname: 'another-host.invalid' }],
  ['unknown worker launch interval', { phase: 'starting-worker' }],
  ['missing running worker PID', { phase: 'running' }],
  ['update source mutation', { operation: 'update' }],
  ['invalid PID', { pid: -1 }],
]) test(`${name} cannot release a lock`, t => {
  const { root } = fixture(t, changes); const plan = planRecovery(root, { runId: 'orphan' });
  assert(plan.blocked.length); assert.throws(() => applyRecovery(root, plan));
  assert(fs.existsSync(path.join(root, '.grandprix/active.json')));
});
test('another run and a stale plan cannot release a lock', t => {
  const { root } = fixture(t), plan = planRecovery(root, { runId: 'orphan' });
  const lockFile = path.join(root, '.grandprix/active.json');
  const changed = { ...JSON.parse(fs.readFileSync(lockFile)), runId: 'another' };
  fs.writeFileSync(lockFile, JSON.stringify(changed));
  assert.throws(() => applyRecovery(root, plan)); assert(fs.existsSync(lockFile));
});
test('a crash before manifest creation is retained as an unqualified interrupted record', t => {
  const { root } = fixture(t, {}, false);
  const plan = planRecovery(root, { runId: 'orphan' }); assert.deepEqual(plan.blocked, []);
  const result = applyRecovery(root, plan); assert.equal(result.status, 'interrupted');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runs/orphan/manifest.json')));
  assert.equal(manifest.source, null); assert.match(manifest.error, /provenance/);
});
test('unknown legacy locks fail closed instead of guessing worker ownership', t => {
  const { root } = fixture(t, { operation: undefined, phase: undefined });
  const plan = planRecovery(root, { runId: 'orphan' }); assert(plan.blocked.length);
});
test('a finished worker that is proven dead can be recovered', t => {
  const workerPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  const { root } = fixture(t, { phase: 'finishing', workerPid, workerProcessGroup: workerPid });
  const plan = planRecovery(root, { runId: 'orphan' }); assert.deepEqual(plan.blocked, []);
  assert.equal(applyRecovery(root, plan).status, 'interrupted');
});
test('interrupted synchronous pit cleanup retains its partial history', t => {
  const { root } = fixture(t, { operation: 'cleanup', phase: undefined });
  const plan = planRecovery(root, { runId: 'orphan' }); assert.deepEqual(plan.blocked, []);
  const result = applyRecovery(root, plan);
  assert.equal(JSON.parse(fs.readFileSync(result.receiptPath)).lockBefore.operation, 'cleanup');
});
test('a recovery command never overwrites another recovery guard', t => {
  const { root } = fixture(t); fs.writeFileSync(path.join(root, '.grandprix/recovery.json'), JSON.stringify({ pid: process.pid }));
  const plan = planRecovery(root, { runId: 'orphan' });
  assert.throws(() => applyRecovery(root, plan), /guard/);
  assert(fs.existsSync(path.join(root, '.grandprix/active.json')));
});
test('a dead direct worker without a recorded process group fails closed', t => {
  const workerPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  const { root } = fixture(t, { phase: 'running', workerPid });
  const plan = planRecovery(root, { runId: 'orphan' });
  assert(plan.blocked.some(reason => reason.includes('process group')));
  assert.throws(() => applyRecovery(root, plan));
});
test('a surviving descendant keeps recovery blocked after its detached leader exits', { skip: process.platform === 'win32' }, async t => {
  const leader = spawn(process.execPath, ['-e', `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    console.log(child.pid);child.unref();
  `], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = ''; leader.stdout.on('data', chunk => { text += chunk; });
  await once(leader, 'close');
  const descendantPid = Number(text.trim()); assert(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  t.after(() => { try { process.kill(descendantPid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } });
  const { root } = fixture(t, { phase: 'running', workerPid: leader.pid, workerProcessGroup: leader.pid });
  const plan = planRecovery(root, { runId: 'orphan' });
  assert.equal(plan.workerState, 'dead'); assert.equal(plan.groupState, 'alive');
  assert(plan.blocked.some(reason => reason.includes('surviving descendants')));
  assert.throws(() => applyRecovery(root, plan));
  assert(fs.existsSync(path.join(root, '.grandprix/active.json')));
});
test('invalid or mismatched process group ownership is refused', t => {
  const workerPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  for (const workerProcessGroup of [-1, 0, workerPid + 1]) {
    const { root } = fixture(t, { phase: 'finishing', workerPid, workerProcessGroup });
    const plan = planRecovery(root, { runId: 'orphan' }); assert(plan.blocked.length);
    assert.throws(() => applyRecovery(root, plan));
  }
});
