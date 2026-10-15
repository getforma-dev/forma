// Test readiness comes only from the child that owns the bound socket.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function withOwnedServer(command, args, cwd, visit, { env = {}, refusal = false, timeout = 30_000 } = {}) {
  const group = process.platform !== 'win32';
  const child = spawn(command, args, { cwd, env: { ...process.env, FORMA_HOST: '127.0.0.1', FORMA_PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: group, windowsHide: true });
  let output = '', ended = false, code = null, spawnError;
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  child.on('error', error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close', value => { ended = true; code = value; resolve(); }));
  const cleanOutput = () => output.replace(/\x1b\[[0-9;]*m/g, '');
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const match = /^FORMA_LISTENING (http:\/\/127\.0\.0\.1:(\d+))\r?$/m.exec(cleanOutput());
      if (match) {
        assert(Number(match[2]) > 0 && Number(match[2]) <= 65535, 'owned server reported an invalid bound port');
        if (refusal) return { code, output: cleanOutput(), accepted: true };
        assert(!ended, `owned server exited after announcing readiness: ${cleanOutput()}`);
        const response = await fetch(match[1]+'/', {signal:AbortSignal.timeout(5_000)});
        assert(!ended, `owned server exited during readiness: ${cleanOutput()}`);
        return await visit(response, match[1], cleanOutput);
      }
      if (ended) {
        if (spawnError) throw spawnError;
        if (refusal) return { code, output: cleanOutput(), accepted: false };
        throw new Error(`owned server exited before readiness (${code}): ${cleanOutput()}`);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (refusal) return { code: null, output: cleanOutput(), accepted: false };
    throw new Error(`owned server never reported its bound address: ${cleanOutput()}`);
  } finally {
    // Same bounded owned-tree cleanup used by the watch fixtures. On Windows,
    // killing only the parent does not close inherited descendant stdio.
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      try {
        if (group) process.kill(-child.pid, 'SIGTERM');
        else await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true,timeout:5_000});
      } catch(error) {
        if (child.exitCode === null && child.signalCode === null && error.code !== 'ESRCH') throw error;
      }
    }
    let timer;
    try { await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('owned server did not close its output pipes')),5_000);})]); }
    finally {clearTimeout(timer);}
  }
}
