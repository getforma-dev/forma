// Linux-only fake-child integration. No browser, Cargo, or original workload.
// Keep every supervisor/worker log, including deliberate refusal controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ownedCommand, runPair, freshEvidencePath } from './check-scheduler-pair.mjs';
import { ROOT } from './check-core-partition.mjs';
import { spawnProofProcess, stopProofProcess } from './router-proof-process.mjs';

assert.equal(process.platform, 'linux', 'actual owner controls require Linux; never count a platform skip as evidence');
const evidence = freshEvidencePath(process.env.FORMA_SCHEDULER_CONTROL_EVIDENCE ?? '');
mkdirSync(evidence);
const specs = [{ id: 'a', browserWorkers: 0, cargoPools: 0 }, { id: 'b', browserWorkers: 2, cargoPools: 0 }];
const save = (name, value) => writeFileSync(resolve(evidence, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
const node = code => [process.execPath, '-e', code];
const cleaned = outcome => {
  assert.equal(outcome.owner.cleanup.complete, true);
  assert.deepEqual(outcome.owner.cleanup.remainingOwnedPids, []);
  assert.equal(outcome.outerGroup.processGroupGone, true);
};
test('the unchanged Linux subreaper passes its own actual launch, descendant, deadline and logging controls', () => {
  const result = spawnSync('python3', [resolve(ROOT, 'scripts/release-owned-linux.test.py')], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  save('inherited-owner-controls', { complete: result.status === 0 && !result.signal && !result.error,
    status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message ?? null });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
});
test('both wrapper-owned lanes preserve complete output and successful cleanup', async () => {
  const record = await runPair({ specs, verifyInputs() {}, save: value => save('success-join', value),
    start: spec => ownedCommand(node(`process.stdout.write(${JSON.stringify('x'.repeat(65536) + 'FINAL-TAIL\n')})`), resolve(evidence, `success-${spec.id}`), 10) });
  assert.equal(record.complete, true);
  for (const row of record.lanes) {
    cleaned(row.outcome);
    assert.equal(readFileSync(resolve(evidence, `success-${row.id}/worker.log`), 'utf8'), 'x'.repeat(65536) + 'FINAL-TAIL\n');
  }
});
test('peer failure cancels a closed-output child, joins cleanup, and leaves unrelated processes alone', async () => {
  const marker = resolve(evidence, 'cancel-ready');
  const unrelated = spawnProofProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  try {
    const programs = {
      a: `const fs=require('node:fs');const end=Date.now()+5000;const interval=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(interval);process.exit(7)}else if(Date.now()>end){process.exit(8)}},10)`,
      b: `const fs=require('node:fs');fs.closeSync(1);fs.closeSync(2);fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`,
    };
    const record = await runPair({ specs, verifyInputs() {}, save: value => save('failure-join', value),
      start: spec => ownedCommand(node(programs[spec.id]), resolve(evidence, `failure-${spec.id}`), 10) });
    assert.equal(record.complete, false); assert(existsSync(marker));
    assert.equal(record.lanes[0].outcome.owner.exitCode, 7);
    assert.equal(record.lanes[1].cancelRequested, 'a failed');
    assert(record.lanes[1].outcome.owner.faults.some(value => value.includes('interruption')));
    for (const row of record.lanes) cleaned(row.outcome);
    assert.equal(unrelated.ended, false); process.kill(unrelated.child.pid, 0);
  } finally { save('unrelated-cleanup', await stopProofProcess(unrelated)); }
});
test('detached descendants, command launch refusal and deadlines cannot become passing outcomes', async () => {
  const detached = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(child.pid);child.unref()`;
  const cases = [
    ['detached', node(detached), 10],
    ['launch', ['/forma-scheduler-control/no-such-command'], 10],
    ['deadline', node('setInterval(()=>{},1000)'), 0.2],
  ];
  for (const [name, command, seconds] of cases) {
    const outcome = await ownedCommand(command, resolve(evidence, name), seconds).closed;
    save(`${name}-outcome`, outcome); assert.equal(outcome.complete, false); cleaned(outcome);
    if (name === 'detached') {
      assert(outcome.owner.faults.includes('producer left live descendants'));
      assert(outcome.owner.cleanup.captured.some(row => row.state !== 'Z'));
    }
  }
});
