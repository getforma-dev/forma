// Test readiness comes only from the child that owns the bound socket.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { appendDiagnostics, tail } from './scaffold-diagnostics.mjs';

const LISTENING = /^FORMA_LISTENING (http:\/\/127\.0\.0\.1:(\d+))\r?$/m;

/**
 * `visit` runs only after the child printed FORMA_LISTENING and answered GET /. It also receives
 * `timings()`: milliseconds from spawn to that line and to that answer, and whether the child has
 * exited. A failure inside `visit` (FORMA-252) carries those timings, a fresh GET / probe taken
 * after the failure and the tail of the server's output, so a browser timeout can be told from a
 * server that stopped answering; the error object itself is kept.
 */
export async function withOwnedServer(command, args, cwd, visit, { env = {}, refusal = false, timeout = 30_000 } = {}) {
  const group = process.platform !== 'win32';
  const started = performance.now(), since = () => Math.round(performance.now() - started);
  const child = spawn(command, args, { cwd, env: { ...process.env, FORMA_HOST: '127.0.0.1', FORMA_PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: group, windowsHide: true });
  let output = '', ended = false, code = null, spawnError, listeningMs = null, readyMs = null, exitedMs = null;
  const cleanOutput = () => output.replace(/\x1b\[[0-9;]*m/g, '');
  const collect = bytes => { output += bytes; if (listeningMs === null && LISTENING.test(cleanOutput())) listeningMs = since(); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close', value => { ended = true; code = value; exitedMs = since(); resolve(); }));
  const timings = () => ({ pid: child.pid, listeningMs, readyMs, elapsedMs: since(), exited: ended, code, exitedMs });
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const match = LISTENING.exec(cleanOutput());
      if (match) {
        assert(Number(match[2]) > 0 && Number(match[2]) <= 65535, 'owned server reported an invalid bound port');
        if (refusal) return { code, output: cleanOutput(), accepted: true };
        assert(!ended, `owned server exited after announcing readiness: ${cleanOutput()}`);
        let response;
        try { response = await fetch(match[1]+'/', {signal:AbortSignal.timeout(5_000)}); }
        catch (error) { throw appendDiagnostics(error, `[owned server] pid ${child.pid}: readiness GET / failed ${since()} ms after spawn (FORMA_LISTENING after ${listeningMs} ms); output ${tail(cleanOutput(), 2000)}`); }
        readyMs = since();
        assert(!ended, `owned server exited during readiness: ${cleanOutput()}`);
        try { return await visit(response, match[1], cleanOutput, timings); }
        catch (error) { throw await explainVisitFailure(error, match[1], timings, cleanOutput); }
      }
      if (ended) {
        if (spawnError) throw spawnError;
        if (refusal) return { code, output: cleanOutput(), accepted: false };
        throw new Error(`owned server exited before readiness (${code}) after ${since()} ms: ${cleanOutput()}`);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (refusal) return { code: null, output: cleanOutput(), accepted: false };
    throw new Error(`owned server never reported its bound address within ${timeout} ms: ${cleanOutput()}`);
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

/** The server's side of a failed visit, probed before cleanup kills it. */
async function explainVisitFailure(error, origin, timings, output) {
  const failedMs = timings().elapsedMs;
  let probe = 'not taken: the server had exited';
  if (!timings().exited) {
    const at = performance.now(), took = () => Math.round(performance.now() - at);
    try {
      const response = await fetch(origin + '/', { signal: AbortSignal.timeout(5_000) });
      await response.arrayBuffer();
      probe = `GET / answered ${response.status} in ${took()} ms`;
    } catch (failure) {
      probe = `GET / failed after ${took()} ms (${failure?.name ?? 'Error'}: ${failure?.cause?.code ?? failure?.message ?? failure})`;
    }
  }
  const state = timings();
  return appendDiagnostics(error, [
    `[owned server] pid ${state.pid} at ${origin}: FORMA_LISTENING ${state.listeningMs} ms after spawn, readiness GET / answered ${state.readyMs} ms after spawn;`
      + ` the visit failed ${failedMs} ms after spawn; ${state.exited ? `the server exited (${state.code}) ${state.exitedMs} ms after spawn` : 'the server was still running'}; probe after the failure: ${probe}`,
    `[owned server] output ${tail(output(), 2000)}`,
  ].join('\n'));
}
