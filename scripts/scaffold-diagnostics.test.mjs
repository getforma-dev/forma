import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { TIMING_ID, appendDiagnostics, describeScaffoldDir, formatMs, processSnapshot, summarizeTimings, tail, timingRow } from './scaffold-diagnostics.mjs';

test('appended diagnostics keep the error object, its type and fields, and reach message and stack', () => {
  class TimeoutError extends Error { constructor(message) { super(message); this.name = 'TimeoutError'; } }
  const original = new TimeoutError('page.goto: Timeout 15000ms exceeded.');
  original.actual = 1;
  const result = appendDiagnostics(original, '[owned server] still running');
  assert.equal(result, original);
  assert(result instanceof TimeoutError);
  assert.equal(result.actual, 1);
  assert.equal(result.message, 'page.goto: Timeout 15000ms exceeded.\n[owned server] still running');
  assert(result.stack.startsWith('TimeoutError: page.goto: Timeout 15000ms exceeded.\n[owned server] still running\n'));
  assert.match(result.stack, /\n\s+at /, 'the frames survive');
});

test('appended diagnostics follow a multi-line message, as Playwright call logs are, in the stack too', () => {
  const error = new Error('page.goto: Timeout 15000ms exceeded.\nCall log:\n  - navigating to "http://127.0.0.1:1/", waiting until "commit"\n');
  appendDiagnostics(error, '[browser] firefox 157.0');
  assert(error.stack.startsWith('Error: page.goto: Timeout 15000ms exceeded.\nCall log:\n  - navigating to "http://127.0.0.1:1/", waiting until "commit"\n\n[browser] firefox 157.0\n'), error.stack);
});

test('appended diagnostics handle empty messages, non-Errors and empty text', () => {
  const empty = appendDiagnostics(new Error(''), 'detail');
  assert.equal(empty.message, 'detail');
  assert(empty.stack.split('\n')[1] === 'detail', 'inserted after the header line');
  const wrapped = appendDiagnostics('thrown text', 'detail');
  assert(wrapped instanceof Error);
  assert.equal(wrapped.message, 'thrown text\ndetail');
  const untouched = new Error('same');
  assert.equal(appendDiagnostics(untouched, '').message, 'same');
});

test('tail and formatMs report what they cut and the scale', () => {
  assert.equal(tail(''), '(no output)');
  assert.equal(tail('short'), 'short');
  assert.equal(tail('abcdef', 3), '(last 3 of 6 characters)\ndef');
  assert.equal(formatMs(812.4), '812ms');
  assert.equal(formatMs(3140), '3.1s');
  assert.equal(formatMs(undefined), '?');
});

test('a scaffold directory says how far the CLI got: absent, copied, git init, git add, commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'forma-diagnostics-'));
  try {
    const dir = join(root, 'probe');
    assert.match(describeScaffoldDir(dir), /absent \(the CLI had not started copying\)/);
    mkdirSync(join(dir, 'admin', 'src'), { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), ''); writeFileSync(join(dir, 'admin', 'src', 'app.tsx'), '');
    assert.match(describeScaffoldDir(dir), /: 2 files outside \.git; no \.git \(git init had not run\)$/);
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true }); writeFileSync(join(dir, '.git', 'HEAD'), '');
    assert.match(describeScaffoldDir(dir), /2 files outside \.git; \.git holds 1 files, no index \(git add had not finished\), no commit$/);
    writeFileSync(join(dir, '.git', 'index'), ''); writeFileSync(join(dir, '.git', 'refs', 'heads', 'main'), '');
    assert.match(describeScaffoldDir(dir), /\.git holds 3 files, index written \(git add ran\), committed on main$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const fakeRun = stdout => () => ({ status: 0, stdout, stderr: '' });

test('a Windows snapshot ranks by CPU seconds and lists what still runs under the killed pid', () => {
  // id|parent|CPU in 100 ns ticks|working set bytes|name, as the PowerShell line prints them.
  const stdout = ['4|0|9000000000|1048576|System', '812|4|31200000000|220200960|MsMpEng.exe', '1200|900|50000000|52428800|git.exe', '1300|900|10000000|10485760|git.exe', '900|7|20000000|41943040|node.exe', ''].join('\r\n');
  let call;
  const snapshot = processSnapshot({ platform: 'win32', parentPid: 900, limit: 2, run: (command, args, options) => { call = { command, args, options }; return fakeRun(stdout)(); } });
  assert.equal(call.command, 'powershell.exe');
  assert(call.args.includes('-EncodedCommand') && call.options.timeout > 0, 'bounded and encoded');
  assert.match(Buffer.from(call.args.at(-1), 'base64').toString('utf16le'), /Get-CimInstance Win32_Process/);
  const [busiest, children] = snapshot.split('\n');
  assert.equal(busiest, 'processes on win32: 5 listed; busiest: MsMpEng.exe pid 812 (3120.0s CPU, 210 MB); System pid 4 (900.0s CPU, 1 MB)');
  assert.equal(children, 'still running under pid 900: git.exe pid 1200 (5.0s CPU, 50 MB); git.exe pid 1300 (1.0s CPU, 10 MB)');
});

test('a POSIX snapshot ranks by %CPU and reports no survivors when none remain', () => {
  const stdout = '    1     0  0.0  1024 /sbin/launchd\n  501     1 87.5 204800 /usr/bin/cargo\n  777   501  3.0  2048 rustc\n';
  const snapshot = processSnapshot({ platform: 'linux', parentPid: 42, limit: 2, run: fakeRun(stdout) });
  assert.equal(snapshot, 'processes on linux: 3 listed; busiest: cargo pid 501 (87.5% CPU, 200 MB); rustc pid 777 (3% CPU, 2 MB)\nstill running under pid 42: none');
});

test('a snapshot never throws: a missing tool, a failing exit or a throwing runner become text', () => {
  assert.match(processSnapshot({ platform: 'linux', run: () => ({ error: Object.assign(new Error('spawnSync ps ENOENT'), { code: 'ENOENT' }) }) }), /^process snapshot unavailable: spawnSync ps ENOENT$/);
  assert.match(processSnapshot({ platform: 'win32', run: () => ({ status: 1, stdout: '', stderr: 'Access denied' }) }), /^process snapshot unavailable: powershell exited 1: Access denied$/);
  assert.match(processSnapshot({ platform: 'darwin', run: () => { throw new Error('boom'); } }), /^process snapshot unavailable: boom$/);
});

test('this host\'s snapshot lists a running child under its parent', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore', windowsHide: true });
  await once(child, 'spawn');
  try {
    const snapshot = processSnapshot({ parentPid: process.pid });
    assert.doesNotMatch(snapshot, /unavailable/, snapshot);
    assert.match(snapshot, new RegExp(`still running under pid ${process.pid}: .*pid ${child.pid} \\(`), snapshot);
  } finally { child.kill(); await once(child, 'exit'); }
});

test('timing rows are selected by id and summarised per kind and phase with budget and failures', () => {
  const rows = [
    timingRow('scaffold CLI', { label: 'a', phases: { cli: 800, staging: 300 }, budgets: { cli: 25_000, staging: 25_000 } }),
    timingRow('scaffold CLI', { label: 'b', phases: { cli: 1200, staging: 500 }, budgets: { cli: 25_000, staging: 25_000 } }),
    timingRow('scaffold CLI', { label: 'c', phases: { cli: 25_010 }, budgets: { cli: 25_000 }, ok: false, status: null }),
    timingRow('owned server', { phases: { listening: 40, ready: null } }),
    { name: 'N8 minimal', id: 'N8', phases: { cli: 999_999 } },
    { name: 'minimal: esbuild inventory', installed: [] },
  ];
  assert.deepEqual(rows[2], { name: 'timing: scaffold CLI', id: TIMING_ID, kind: 'scaffold CLI', label: 'c', phases: { cli: 25_010 }, budgets: { cli: 25_000 }, ok: false, status: null });
  assert.equal(summarizeTimings(rows, 'win32'),
    'scaffold timings (win32): scaffold CLI: cli n=3 p50=1.2s p90=20.2s max=25.0s/25.0s, staging n=2 p50=400ms p90=480ms max=500ms/25.0s, 1 failed; owned server: listening n=1 p50=40ms p90=40ms max=40ms');
  assert.equal(summarizeTimings([], 'linux'), 'scaffold timings (linux): none recorded');
  assert.equal(summarizeTimings(JSON.parse(JSON.stringify([timingRow('owned server', { phases: { listening: NaN } })])), 'linux'), 'scaffold timings (linux): owned server: no figures');
});
