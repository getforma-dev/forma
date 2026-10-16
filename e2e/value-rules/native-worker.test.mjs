import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeWorker } from './native-worker.mjs';

// Real pipe/process boundaries: the worker must return before stdin closes,
// preserve multiple batches, and fail a silent/malformed child within a bound.
test('one process handles two framed batches without waiting for EOF', async () => {
  const worker = nativeWorker(process.execPath, ['--input-type=module', '-e', `
    import { createInterface } from 'node:readline';
    for await (const line of createInterface({input: process.stdin}))
      console.log(JSON.stringify({pid:process.pid, inputs:JSON.parse(line)}));
  `]);
  try {
    const first = await worker.batch([{ value: 'CR\r\nNUL\0😀' }]);
    const second = await worker.batch([{ value: 42 }]);
    assert.equal(first.pid, worker.pid); assert.equal(second.pid, worker.pid);
    assert.deepEqual(first.inputs, [{ value: 'CR\r\nNUL\0😀' }]);
    assert.deepEqual(second.inputs, [{ value: 42 }]);
  } finally { await worker.close(); }
});
test('a silent native child fails by the per-batch deadline', async () => {
  const worker = nativeWorker(process.execPath, ['-e', 'process.stdin.resume()'], { timeoutMs: 100 });
  try { await assert.rejects(worker.batch([1]), /timed out after 100 ms/); }
  finally { await worker.close(); }
});
test('malformed native output fails instead of counting a completed batch', async () => {
  const worker = nativeWorker(process.execPath, ['-e', `process.stdin.on('data',()=>process.stdout.write('not-json\\n'))`]);
  try { await assert.rejects(worker.batch([1]), /invalid native JSON/); }
  finally { await worker.close(); }
});
