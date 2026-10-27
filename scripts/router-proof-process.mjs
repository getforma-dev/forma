// Process ownership for the native router source proof. Keep each POSIX child
// tree in its own group; Windows uses taskkill /T and waits for inherited pipes.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandInvocation } from './portable-command.mjs';
const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export function spawnProofProcess(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const group = process.platform !== 'win32';
  const child = spawn(invocation.command, invocation.args, { ...options, detached: group, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const handle = { child, group, ended: false, groupStopped: false, error: undefined, closed: undefined };
  child.on('error', error => { handle.error = error; });
  handle.closed = new Promise(resolve => child.once('close', (code, signal) => {
    handle.ended = true;
    if (group && child.pid && !groupAlive(child.pid)) handle.groupStopped = true;
    resolve({ code, signal, error: handle.error });
  }));
  return handle;
}
export async function stopProofProcess(handle, { graceMs = 3000, killMs = 3000 } = {}) {
  const { child, group } = handle;
  let escalated = false;
  const stopped = () => {
    if (group && child.pid && !handle.groupStopped && !groupAlive(child.pid)) handle.groupStopped = true;
    return handle.ended && (!group || !child.pid || handle.groupStopped);
  };
  const wait = async ms => {
    const deadline = Date.now() + ms;
    while (!stopped() && Date.now() < deadline) await pause(20);
    return stopped();
  };
  if (!stopped() && child.pid) {
    if (group) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    } else {
      try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }); }
      catch (error) { if (!handle.ended) throw error; }
    }
  }
  if (!await wait(graceMs)) {
    escalated = true;
    if (group && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (!await wait(killMs)) throw Error(`Proof child ${child.pid ?? 'unspawned'} or its inherited output did not stop within cleanup deadline`);
  }
  return { pid: child.pid ?? null, closed: handle.ended, method: group ? 'POSIX process group' : 'Windows taskkill /T and inherited-pipe close', processGroupGone: group ? handle.groupStopped || !child.pid : null, escalated };
}
