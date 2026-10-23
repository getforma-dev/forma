import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { SNAPSHOT_TIMEOUT_MS, TIMING_ID, appendDiagnostics, describeScaffoldDir, formatMs, processSnapshot, summarizeTimings, tail, timingRow } from './scaffold-diagnostics.mjs';

const occurrences = (text, part) => text.split(part).length - 1;

test('appended diagnostics keep the error object, its type and fields, and reach message and stack once', () => {
  class TimeoutError extends Error { constructor(message) { super(message); this.name = 'TimeoutError'; } }
  const original = new TimeoutError('page.goto: Timeout 15000ms exceeded.');
  original.actual = 1;
  const result = appendDiagnostics(original, '[owned server] still running');
  assert.equal(result, original);
  assert(result instanceof TimeoutError);
  assert.equal(result.actual, 1);
  assert.equal(result.message, 'page.goto: Timeout 15000ms exceeded.\n[owned server] still running');
  const lines = result.stack.split('\n');
  assert.deepEqual(lines.slice(0, 2), ['TimeoutError: page.goto: Timeout 15000ms exceeded.', '[owned server] still running']);
  assert.match(lines[2], /^\s+at /, 'the frames follow the text');
  assert.equal(occurrences(result.stack, '[owned server]'), 1, 'a stack nobody had read is not given the text twice');
});

test('a stack read before the append is rewritten to carry the text once', () => {
  const error = new Error('server check failed');
  assert.equal(error.stack.split('\n')[0], 'Error: server check failed', 'formatted before the append');
  appendDiagnostics(error, '[owned server] probe failed');
  assert.deepEqual(error.stack.split('\n').slice(0, 2), ['Error: server check failed', '[owned server] probe failed']);
  assert.equal(occurrences(error.stack, '[owned server]'), 1);
});

test('the text reaches the stack once when it or the message holds frame-like lines, as a Rust or Node backtrace does (FORMA-265)', () => {
  // An owned-server output tail can end in a Rust backtrace, whose location lines look like frames.
  const backtrace = [
    "[owned server] output thread 'main' panicked at src/main.rs:3:5:",
    'stack backtrace:',
    '   0: rust_begin_unwind',
    '             at /rustc/90b35a6239c3d8bdabc530a6a0816f7ff89a0aaf/library/std/src/panicking.rs:665:5',
  ].join('\n');
  const cases = [
    { message: 'page.goto: Timeout 15000ms exceeded.', text: backtrace },
    { message: 'visit failed: Error: inner\n    at inner (file:///app/server.mjs:1:1)', text: '[owned server] still running' },
  ];
  for (const { message, text } of cases) {
    for (const read of [false, true]) {
      const error = new Error(message);
      if (read) error.stack;
      appendDiagnostics(error, text);
      assert.equal(error.message, `${message}\n${text}`);
      assert.equal(occurrences(error.stack, '[owned server]'), 1, `${read ? 'read' : 'unread'} stack:\n${error.stack}`);
      assert(error.stack.startsWith(`Error: ${message}\n${text}\n    at `), error.stack);
    }
  }
});

test('a read stack takes the text even when its frames already hold the same characters (FORMA-265)', () => {
  const error = new Error('');
  const frame = error.stack.split('\n')[1];
  const text = frame.replace(/^\s+at /, '');
  appendDiagnostics(error, text);
  assert.deepEqual(error.stack.split('\n').slice(0, 3), ['Error', text, frame], 'only text before the first frame counts as already there');
});

test('a read stack takes the text after its message even when the error name contains that message (FORMA-265 review)', () => {
  class TimeoutError extends Error { constructor(message) { super(message); this.name = 'TimeoutError'; } }
  const renamed = () => { const error = new Error('Error'); error.stack; error.name = 'Other'; return error; };
  // A header that no longer ends with the message: the text still follows the first line.
  const rewritten = () => { const error = new Error('first'); error.stack; error.message = 'second'; return error; };
  const errors = [new TimeoutError('Timeout'), new Error('Error'), new Error('r'), new TypeError('Type'), new Error(': '),
    new DOMException('Timeout', 'TimeoutError'), new assert.AssertionError({ message: 'Assertion' }), renamed(), rewritten()];
  for (const error of errors) {
    const header = error.stack.split('\n')[0], message = error.message;
    appendDiagnostics(error, '[diag] detail');
    assert.equal(error.message, `${message}\n[diag] detail`);
    assert(error.stack.startsWith(`${header}\n[diag] detail\n    at `), error.stack);
    assert.equal(occurrences(error.stack, '[diag] detail'), 1);
  }
});

test('a DOMException timeout, whose message is a getter, keeps its identity and takes the text (FORMA-252 review B1)', async () => {
  const made = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.equal(appendDiagnostics(made, '[owned server] readiness GET / failed'), made);
  assert.equal(made.name, 'TimeoutError');
  assert.equal(made.message, 'The operation was aborted due to timeout\n[owned server] readiness GET / failed');
  assert.equal(occurrences(made.stack, '[owned server]'), 1, made.stack);
  // The real rejection: fetch against a server that never answers.
  const server = createServer(() => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const failure = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(200) }).then(() => assert.fail('answered'), error => error);
    assert.equal(failure.name, 'TimeoutError');
    assert.equal(Object.hasOwn(failure, 'message'), false, 'the message is inherited, as in Node 24');
    const stackBefore = failure.stack;
    assert.equal(appendDiagnostics(failure, 'probe detail'), failure);
    assert.equal(failure.message, 'The operation was aborted due to timeout\nprobe detail');
    assert.equal(occurrences(failure.stack, 'probe detail'), 1);
    assert(failure.stack.startsWith(stackBefore.split('\n')[0]), failure.stack);
  } finally { server.closeAllConnections(); server.close(); }
});

test('an error that cannot take a new message is wrapped, with the original as its cause', () => {
  const frozen = Object.freeze(new RangeError('frozen failure'));
  const result = appendDiagnostics(frozen, 'detail');
  assert.notEqual(result, frozen);
  assert.equal(result.message, 'frozen failure\ndetail');
  assert.equal(result.cause, frozen);
});

test('appended diagnostics follow a multi-line message, as Playwright call logs are, in the stack too', () => {
  const message = 'page.goto: Timeout 15000ms exceeded.\nCall log:\n  - navigating to "http://127.0.0.1:1/", waiting until "commit"\n';
  const error = new Error(message);
  error.stack;
  appendDiagnostics(error, '[browser] firefox 157.0');
  assert(error.stack.startsWith(`Error: ${message}\n[browser] firefox 157.0\n    at `), error.stack);
  assert.equal(occurrences(error.stack, '[browser]'), 1);
});

test('appended diagnostics handle empty messages, non-Errors and empty text', () => {
  const empty = appendDiagnostics(new Error(''), 'detail');
  assert.equal(empty.message, 'detail');
  assert.equal(empty.stack.split('\n')[0], 'Error: detail', 'an unread stack is formatted from the new message');
  const emptyRead = new Error('');
  assert.equal(emptyRead.stack.split('\n')[0], 'Error');
  appendDiagnostics(emptyRead, 'detail');
  assert.deepEqual(emptyRead.stack.split('\n').slice(0, 2), ['Error', 'detail'], 'inserted after the header line');
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
  const stdout = ['0|0|99000000000|8192|System Idle Process', '4|0|9000000000|1048576|System', '812|4|31200000000|220200960|MsMpEng.exe', '1200|900|50000000|52428800|git.exe', '1300|900|10000000|10485760|git.exe', '900|7|20000000|41943040|node.exe', ''].join('\r\n');
  let call;
  const snapshot = processSnapshot({ platform: 'win32', parentPid: 900, limit: 2, timeout: 4_000, run: (command, args, options) => { call = { command, args, options }; return fakeRun(stdout)(); } });
  assert.equal(call.command, 'powershell.exe');
  assert(call.args.includes('-EncodedCommand'), 'encoded, so no argument quoting applies');
  assert.equal(call.options.timeout, 4_000, 'bounded by the caller');
  assert.match(Buffer.from(call.args.at(-1), 'base64').toString('utf16le'), /Get-CimInstance Win32_Process/);
  const [busiest, children] = snapshot.split('\n');
  assert.equal(busiest, 'processes on win32: 6 listed; busiest: MsMpEng.exe pid 812 (3120.0s CPU, 210 MB); System pid 4 (900.0s CPU, 1 MB)');
  assert.equal(children, 'still running under pid 900: git.exe pid 1200 (5.0s CPU, 50 MB); git.exe pid 1300 (1.0s CPU, 10 MB)');
});

test('a POSIX snapshot ranks by %CPU and reports no survivors when none remain', () => {
  const stdout = '    1     0  0.0  1024 /sbin/launchd\n  501     1 87.5 204800 /usr/bin/cargo\n  777   501  3.0  2048 rustc\n';
  let timeout;
  const snapshot = processSnapshot({ platform: 'linux', parentPid: 42, limit: 2, run: (command, args, options) => { timeout = options.timeout; return fakeRun(stdout)(); } });
  assert.equal(timeout, SNAPSHOT_TIMEOUT_MS, 'bounded by default');
  assert.equal(SNAPSHOT_TIMEOUT_MS, 30_000);
  assert.equal(snapshot, 'processes on linux: 3 listed; busiest: cargo pid 501 (87.5% CPU, 200 MB); rustc pid 777 (3% CPU, 2 MB)\nstill running under pid 42: none');
});

test('a snapshot never throws: a missing tool, a failing exit or a throwing runner become text', () => {
  assert.match(processSnapshot({ platform: 'linux', run: () => ({ error: Object.assign(new Error('spawnSync ps ENOENT'), { code: 'ENOENT' }) }) }), /^process snapshot unavailable: spawnSync ps ENOENT$/);
  assert.match(processSnapshot({ platform: 'win32', run: () => ({ status: 1, stdout: '', stderr: 'Access denied' }) }), /^process snapshot unavailable: powershell exited 1: Access denied$/);
  assert.match(processSnapshot({ platform: 'darwin', run: () => { throw new Error('boom'); } }), /^process snapshot unavailable: boom$/);
});

// The real listing took 4.4 s on a healthy Windows runner; a generous bound keeps this control from
// flaking on a slow one without changing what it asserts.
test('this host\'s snapshot lists a running child under its parent', { timeout: 180_000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 170_000)'], { stdio: 'ignore', windowsHide: true });
  await once(child, 'spawn');
  try {
    const snapshot = processSnapshot({ parentPid: process.pid, timeout: 120_000 });
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
