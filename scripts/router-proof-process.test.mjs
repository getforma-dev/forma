import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnProofProcess, stopProofProcess } from './router-proof-process.mjs';
const grandchild = `const http=require('node:http');process.on('SIGTERM',()=>{});http.createServer((q,s)=>s.end('owned descendant')).listen(0,'127.0.0.1',function(){console.log('READY http://127.0.0.1:'+this.address().port)});`;
const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000);`;
function ready(handle) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Descendant did not report readiness')), 5000);
    handle.child.stdout.on('data', bytes => { output += bytes; const match = /^READY (http:\/\/127\.0\.0\.1:\d+)/m.exec(output); if (match) { clearTimeout(timer); resolve(match[1]); } });
    handle.child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
test('normal completion and spawn refusal close their streams without claiming a live tree', async () => {
  const success = spawnProofProcess(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal((await success.closed).code, 0); assert.equal((await stopProofProcess(success)).closed, true);
  const refused = spawnProofProcess('forma-proof-command-that-does-not-exist', []);
  assert.equal((await refused.closed).error.code, 'ENOENT'); assert.equal((await stopProofProcess(refused)).closed, true);
});
test('cancellation closes a real owned descendant listener and inherited output', async () => {
  const handle = spawnProofProcess(process.execPath, ['-e', parent]);
  try {
    const origin = await ready(handle);
    assert.equal(await (await fetch(origin)).text(), 'owned descendant');
    const cleanup = await stopProofProcess(handle, { graceMs: 100, killMs: 5000 });
    assert.equal(cleanup.closed, true);
    if (process.platform !== 'win32') { assert.equal(cleanup.processGroupGone, true); assert.equal(cleanup.escalated, true); }
    await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }));
  } finally { await stopProofProcess(handle, { graceMs: 100, killMs: 5000 }); }
});
test('negative control: direct parent exit leaves its descendant alive until group cleanup', { skip: process.platform === 'win32' }, async () => {
  const handle = spawnProofProcess(process.execPath, ['-e', parent]);
  try {
    const origin = await ready(handle);
    await new Promise(resolve => { handle.child.once('exit', resolve); handle.child.kill('SIGKILL'); });
    assert.equal(await (await fetch(origin)).text(), 'owned descendant', 'direct exit must not masquerade as tree cleanup');
    assert.equal(handle.ended, false, 'descendant still owns inherited stdout');
    const cleanup = await stopProofProcess(handle, { graceMs: 100, killMs: 5000 });
    assert.equal(cleanup.closed, true); assert.equal(cleanup.processGroupGone, true);
    await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }));
  } finally { await stopProofProcess(handle, { graceMs: 100, killMs: 5000 }); }
});
