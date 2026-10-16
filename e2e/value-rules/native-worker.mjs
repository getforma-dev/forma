import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

/** One native process, one bounded JSON line per request/response, one request
 * in flight. Explicit framing avoids depending on per-batch stdin EOF. */
export function nativeWorker(command, args, { cwd, timeoutMs = 30_000 } = {}) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  let pending, terminal, ending = false, buffer = '', stderr = '';
  const fail = error => {
    terminal ??= error;
    pending?.finish(error);
    child.kill();
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { stderr = (stderr + text).slice(-64 * 1024); });
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', (code, signal) => {
    if (pending || (!ending && (code !== 0 || signal))) fail(new Error(`native exited ${code ?? signal}: ${stderr}`));
  });
  child.stdout.on('data', text => {
    buffer += text;
    if (Buffer.byteLength(buffer) > 64 * 1024 * 1024) return fail(new Error('native response exceeded 64 MiB'));
    for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!pending) return fail(new Error('unsolicited native response'));
      try { pending.finish(null, JSON.parse(line)); }
      catch (error) { fail(new Error(`invalid native JSON: ${error.message}`)); }
    }
  });
  return {
    pid: child.pid,
    batch(inputs) {
      assert(!pending, 'only one native batch may be in flight');
      assert(Array.isArray(inputs) && inputs.length <= 10_000, 'bounded native batch');
      const input = JSON.stringify(inputs) + '\n';
      assert(Buffer.byteLength(input) <= 16 * 1024 * 1024, 'native request exceeded 16 MiB');
      if (terminal) return Promise.reject(terminal);
      if (child.exitCode !== null || child.signalCode !== null) return Promise.reject(new Error('native worker is closed'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error(`native batch timed out after ${timeoutMs} ms: ${stderr}`)), timeoutMs);
        pending = { finish(error, value) { clearTimeout(timer); pending = undefined; error ? reject(error) : resolve(value); } };
        child.stdin.write(input);
      });
    },
    async close() {
      ending = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      try { await closed; } finally { clearTimeout(timer); }
    },
  };
}
