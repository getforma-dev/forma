// Failure and timing evidence for the packed scaffold suite (FORMA-252). Nothing here decides a
// verdict or moves a budget: it explains a timeout after the fact (how long, how far the process
// got, what the host was doing) and records how long the process-backed steps took on every run,
// so a slow Windows runner can be told from a hang with data instead of a retry.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Observation id of the timing rows; consumers of the scaffold report select rows by id. */
export const TIMING_ID = 'TIMING';

/**
 * Append `text` to an error's message and to the copy of the message in its stack, keeping the
 * error object (its type, `cause`, assertion `actual`/`expected`). A non-Error becomes an Error.
 */
export function appendDiagnostics(error, text) {
  if (!text) return error;
  const target = error instanceof Error ? error : new Error(String(error));
  const before = target.message, after = before ? `${before}\n${text}` : text;
  target.message = after;
  if (typeof target.stack === 'string') {
    const at = before ? target.stack.indexOf(before) : -1;
    if (at >= 0) target.stack = target.stack.slice(0, at) + after + target.stack.slice(at + before.length);
    else {
      const newline = target.stack.indexOf('\n');
      target.stack = newline < 0 ? `${target.stack}\n${text}` : `${target.stack.slice(0, newline)}\n${text}${target.stack.slice(newline)}`;
    }
  }
  return target;
}

/** The last `limit` characters of `text`, saying how much was cut. */
export function tail(text, limit = 2000) {
  const value = String(text ?? '');
  if (!value.trim()) return '(no output)';
  return value.length <= limit ? value : `(last ${limit} of ${value.length} characters)\n${value.slice(-limit)}`;
}

/** Milliseconds as a short human figure: 812ms, 3.1s. */
export function formatMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function countFiles(dir) {
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    files += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return files;
}

/**
 * How far a scaffold got when its CLI was stopped: the CLI copies the template, then runs
 * `git init`, `git add -A` and `git commit` (packages/create-app/src/index.ts). Never throws.
 */
export function describeScaffoldDir(dir) {
  try {
    if (!existsSync(dir)) return `${dir}: absent (the CLI had not started copying)`;
    let outside = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      outside += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
    }
    const git = join(dir, '.git');
    if (!existsSync(git)) return `${dir}: ${outside} files outside .git; no .git (git init had not run)`;
    const heads = join(git, 'refs', 'heads');
    const branches = existsSync(heads) ? readdirSync(heads) : [];
    const index = existsSync(join(git, 'index')) ? 'index written (git add ran)' : 'no index (git add had not finished)';
    const commit = branches.length ? `committed on ${branches.join(', ')}` : 'no commit';
    return `${dir}: ${outside} files outside .git; .git holds ${countFiles(git)} files, ${index}, ${commit}`;
  } catch (error) {
    return `${dir}: could not be read (${error?.code ?? error?.message ?? error})`;
  }
}

// One PowerShell line per process: id|parent|CPU in 100 ns ticks|working set bytes|name. Integers
// only, so no locale changes a figure. Sent encoded, so no argument quoting applies.
const WINDOWS_PROCESSES = "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.ProcessId,$_.ParentProcessId,($_.UserModeTime+$_.KernelModeTime),$_.WorkingSetSize,$_.Name }";

function listProcesses(platform, run, timeout) {
  if (platform === 'win32') {
    const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_PROCESSES, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`powershell exited ${result.status}: ${String(result.stderr ?? '').trim().slice(0, 300)}`);
    return String(result.stdout).split(/\r?\n/).filter(Boolean).map(line => {
      const [pid, ppid, ticks, bytes, ...name] = line.split('|');
      return { pid: Number(pid), ppid: Number(ppid), load: Number(ticks) / 1e7, memoryMb: Math.round(Number(bytes) / 1048576), name: name.join('|') };
    }).filter(row => Number.isInteger(row.pid));
  }
  const result = run('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'pcpu=', '-o', 'rss=', '-o', 'comm='], { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ps exited ${result.status}: ${String(result.stderr ?? '').trim().slice(0, 300)}`);
  return String(result.stdout).split(/\r?\n/).map(line => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map(([, pid, ppid, pcpu, rss, name]) => ({ pid: Number(pid), ppid: Number(ppid), load: Number(pcpu), memoryMb: Math.round(Number(rss) / 1024), name: basename(name.trim()) }));
}

/**
 * A bounded, best-effort look at the host when a step timed out: the busiest processes (Windows: by
 * CPU seconds since start; elsewhere: by %CPU) and any processes whose parent is `parentPid`, i.e.
 * children a killed process left running. Windows keeps a dead parent's id on its children; POSIX
 * reparents them, so there the list only shows children of a parent that is still alive. Never
 * throws; `timeout` bounds the listing, so a caller can keep it inside its own budget; `run` is
 * replaceable for tests.
 */
export function processSnapshot({ parentPid, limit = 8, platform = process.platform, timeout = 10_000, run = spawnSync } = {}) {
  try {
    const rows = listProcesses(platform, run, timeout);
    const unit = platform === 'win32' ? 's CPU' : '% CPU';
    const show = row => `${row.name} pid ${row.pid} (${platform === 'win32' ? row.load.toFixed(1) : row.load}${unit}, ${row.memoryMb} MB)`;
    // Windows reports idle CPU time as the System Idle Process (pid 0); it is never a busy process.
    const busiest = rows.filter(row => platform !== 'win32' || row.pid !== 0).sort((a, b) => b.load - a.load).slice(0, limit).map(show);
    const parts = [`processes on ${platform}: ${rows.length} listed; busiest: ${busiest.join('; ') || 'none'}`];
    if (parentPid !== undefined) {
      const children = rows.filter(row => row.ppid === parentPid && row.pid !== parentPid).map(show);
      parts.push(`still running under pid ${parentPid}: ${children.join('; ') || 'none'}`);
    }
    return parts.join('\n');
  } catch (error) {
    return `process snapshot unavailable: ${error?.message ?? error}`;
  }
}

/**
 * One timing observation for the scaffold report. `phases` maps a phase name to milliseconds;
 * `budgets` maps a phase to the limit it ran under, so the summary shows the headroom.
 */
export function timingRow(kind, { label, phases, budgets, ok = true, ...details } = {}) {
  return { name: `timing: ${kind}`, id: TIMING_ID, kind, label, phases, budgets, ok, ...details };
}

function percentile(sorted, p) {
  const rank = (sorted.length - 1) * p, low = Math.floor(rank), high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * The one-line timing summary printed after every scaffold run, pass or fail: for each kind and
 * phase, n / p50 / p90 / max and the budget where one applies, and how many rows did not finish.
 */
export function summarizeTimings(observations = [], platform = process.platform) {
  const rows = observations.filter(row => row?.id === TIMING_ID && row.phases && typeof row.phases === 'object');
  if (!rows.length) return `scaffold timings (${platform}): none recorded`;
  const kinds = new Map();
  for (const row of rows) {
    const kind = kinds.get(row.kind) ?? { phases: new Map(), failed: 0 };
    if (row.ok === false) kind.failed++;
    for (const [phase, ms] of Object.entries(row.phases)) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) continue;
      const entry = kind.phases.get(phase) ?? { values: [], budget: undefined };
      entry.values.push(ms);
      const budget = row.budgets?.[phase];
      if (typeof budget === 'number') entry.budget = Math.max(entry.budget ?? 0, budget);
      kind.phases.set(phase, entry);
    }
    kinds.set(row.kind, kind);
  }
  const parts = [...kinds].map(([kind, { phases, failed }]) => `${kind}: ${[...phases].map(([phase, { values, budget }]) => {
    const sorted = values.sort((a, b) => a - b);
    return `${phase} n=${sorted.length} p50=${formatMs(percentile(sorted, 0.5))} p90=${formatMs(percentile(sorted, 0.9))} max=${formatMs(sorted.at(-1))}${budget ? `/${formatMs(budget)}` : ''}`;
  }).join(', ') || 'no figures'}${failed ? `, ${failed} failed` : ''}`);
  return `scaffold timings (${platform}): ${parts.join('; ')}`;
}
