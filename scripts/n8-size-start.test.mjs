// N8's threshold, parse and measurement logic, with no Rust toolchain: stand-in servers are Node scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  N8_MAX_ADDED_BYTES, N8_MAX_ADDED_START_MS, N8_TEMPLATES, n8Name, parseListening, median, evaluateN8, assertN8, describeN8,
  requireN8Observations, summarizeN8, measureStartOnce, measureStarts, buildBaseline, N8_RUNS,
} from './n8-size-start.mjs';

// The recorded rows carry the full N8_RUNS timed starts; the pure threshold cases below use fewer where it reads better.
const full = pattern => Array.from({ length: N8_RUNS }, (_, i) => pattern[i % pattern.length]);
const base = { template: 'minimal', formaBytes: 5_000_000, baselineBytes: 2_000_000, formaStartMs: full([12, 11, 13]), baselineStartMs: full([8, 9, 10]) };
const observation = (template, patch = {}) => ({ name: n8Name(template), ...evaluateN8({ ...base, template, ...patch }) });

test('the ceilings are N8\'s: 3 MB and 100 ms', () => {
  assert.equal(N8_MAX_ADDED_BYTES, 3_000_000);
  assert.equal(N8_MAX_ADDED_START_MS, 100);
  assert.deepEqual(N8_TEMPLATES, ['minimal', 'dashboard']);
});

test('readiness is only a bound 127.0.0.1 port on its own line, through colour codes', () => {
  assert.equal(parseListening('noise\nFORMA_LISTENING http://127.0.0.1:41233\n'), 41233);
  assert.equal(parseListening('\x1b[0mFORMA_LISTENING http://127.0.0.1:8080\n'), 8080);
  assert.equal(parseListening('FORMA_LISTENING http://127.0.0.1:41233\r\n'), 41233);
  for (const text of ['', 'FORMA_LISTENING http://127.0.0.1:0\n', 'FORMA_LISTENING http://127.0.0.1:99999\n', 'FORMA_LISTENING http://0.0.0.0:80\n', 'log FORMA_LISTENING http://127.0.0.1:80\n', 'Listening on 127.0.0.1:80\n']) {
    assert.equal(parseListening(text), null, JSON.stringify(text));
  }
});

test('median is the middle value and the mean of the two middle values; it refuses an empty list and non-numbers', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([900, 5, 6, 7, 8]), 7); // one descheduled run does not move it
  assert.throws(() => median([]), /non-empty/);
  assert.throws(() => median([1, Number.NaN]), /finite/);
});

test('size: exactly 3,000,000 added bytes passes and one more fails, with both numbers in the message', () => {
  const at = evaluateN8({ ...base, baselineBytes: 1_000_000, formaBytes: 4_000_000 });
  assert.equal(at.addedBytes, 3_000_000);
  assert.equal(at.sizeOk, true); assert.equal(at.passed, true);
  assert.equal(assertN8(at), at);
  const over = evaluateN8({ ...base, baselineBytes: 1_000_000, formaBytes: 4_000_001 });
  assert.equal(over.sizeOk, false); assert.equal(over.startOk, true); assert.equal(over.passed, false);
  assert.throws(() => assertN8(over), /N8 minimal exceeded its ceiling\. size: Forma adds 3,000,001 bytes, over N8's 3,000,000 \(template 4,000,001, baseline 1,000,000\)/);
});

test('start: 100 ms added passes, 100.1 ms fails; the verdict is on the difference of medians, not the absolute time', () => {
  const at = evaluateN8({ ...base, baselineStartMs: [20, 20, 20], formaStartMs: [120, 120, 120] });
  assert.equal(at.addedStartMs, 100); assert.equal(at.startOk, true);
  const over = evaluateN8({ ...base, baselineStartMs: [20, 20, 20], formaStartMs: [120.2, 120.2, 120.2] });
  assert.equal(over.addedStartMs, 100.2); assert.equal(over.startOk, false); assert.equal(over.sizeOk, true);
  assert.throws(() => assertN8(over), /start: Forma adds 100\.2 ms to start, over N8's 100 ms \(template median 120\.2 ms, baseline median 20 ms\)/);
  // A slow machine slows both sides; the absolute time is not the ceiling.
  assert.equal(evaluateN8({ ...base, baselineStartMs: [400, 410, 405], formaStartMs: [420, 430, 425] }).passed, true);
  // One outlier among the timed starts does not fail the gate; a shift of every run does.
  assert.equal(evaluateN8({ ...base, formaStartMs: [12, 11, 13, 12, 900] }).startOk, true);
  assert.equal(evaluateN8({ ...base, formaStartMs: [140, 141, 139, 140, 142] }).startOk, false);
});

test('both ceilings are reported together', () => {
  const row = evaluateN8({ ...base, baselineBytes: 1_000_000, formaBytes: 9_000_000, baselineStartMs: [10], formaStartMs: [500] });
  assert.throws(() => assertN8(row), error => /size: .*start: /.test(error.message));
  assert.match(describeN8(row), /Forma adds 8,000,000 bytes \(8\.000 MB; limit 3,000,000\) and 490 ms to start/);
});

test('a broken measurement is refused, not passed: missing, non-positive or inverted inputs', () => {
  assert.throws(() => evaluateN8({ ...base, baselineBytes: 5_000_000 }), /not smaller/);
  assert.throws(() => evaluateN8({ ...base, baselineBytes: 6_000_000 }), /not smaller/);
  assert.throws(() => evaluateN8({ ...base, formaBytes: 0 }), /positive byte count/);
  assert.throws(() => evaluateN8({ ...base, formaBytes: 1.5 }), /positive byte count/);
  assert.throws(() => evaluateN8({ ...base, formaStartMs: [] }), /non-empty/);
  assert.throws(() => evaluateN8({ ...base, baselineStartMs: [10, -1] }), /positive durations/);
  assert.throws(() => evaluateN8({ ...base, formaStartMs: undefined }), /non-empty/);
});

test('the report must carry one re-derived N8 row per template on Linux and nothing elsewhere', () => {
  const both = N8_TEMPLATES.map(template => observation(template));
  assert.equal(requireN8Observations(both, 'linux').length, 2);
  assert.deepEqual(requireN8Observations([], 'win32'), []);
  assert.deepEqual(requireN8Observations([], 'darwin'), []);
  assert.throws(() => requireN8Observations([], 'linux'), /N8 minimal: .*found 0/);
  assert.throws(() => requireN8Observations(both.slice(0, 1), 'linux'), /N8 dashboard: .*found 0/);
  assert.throws(() => requireN8Observations([...both, both[0]], 'linux'), /N8 minimal: .*found 2/);
  // A stored passed flag is never trusted: an over-ceiling row that claims to pass is re-derived and refused.
  const forged = { ...observation('minimal', { formaBytes: 9_000_000 }), passed: true, sizeOk: true };
  assert.throws(() => requireN8Observations([forged, observation('dashboard')], 'linux'), /size: Forma adds 7,000,000 bytes/);
  const slow = { ...observation('dashboard', { formaStartMs: full([300, 301, 302]) }), passed: true, startOk: true };
  assert.throws(() => requireN8Observations([observation('minimal'), slow], 'linux'), /start: Forma adds/);
  // A row with too few timed starts is not a median: one lucky sample per side is refused.
  assert.throws(() => requireN8Observations([observation('minimal', { formaStartMs: [12], baselineStartMs: [9] }), observation('dashboard')], 'linux'), /formaStartMs holds 1 timed starts, N8 needs at least 15/);
  assert.throws(() => requireN8Observations([observation('minimal'), observation('dashboard', { baselineStartMs: full([9]).slice(0, N8_RUNS - 1) })], 'linux'), /baselineStartMs holds 14 timed starts/);
  // A row without raw samples cannot be re-derived.
  const { formaStartMs, ...bare } = observation('minimal');
  assert.throws(() => requireN8Observations([bare, observation('dashboard')], 'linux'), /formaStartMs/);
});

test('the job summary lists each template with its verdict', () => {
  const text = summarizeN8({ platform: 'linux', observations: [{ name: 'other' }, ...N8_TEMPLATES.map(t => observation(t))] });
  assert.match(text, /\| minimal \| 3,000,000 B \| 3 ms \| 12 ms \| 9 ms \| pass \|/);
  assert.match(text, /\| dashboard \|/);
  assert.match(summarizeN8({ platform: 'win32', observations: [] }), /No N8 observation .* win32/);
  assert.match(summarizeN8({ platform: 'linux', observations: [observation('minimal', { formaBytes: 9_000_000 })] }), /FAIL/);
});

// Stand-in servers: real processes that print the readiness line after a delay, like a bound listener would.
const dir = mkdtempSync(join(tmpdir(), 'n8-start-'));
const here = dirname(fileURLToPath(import.meta.url));
const server = (name, delayMs, body = '') => {
  const file = join(dir, name);
  writeFileSync(file, `${body}setTimeout(() => { console.log('FORMA_LISTENING http://127.0.0.1:' + (process.env.FORMA_PORT === '0' ? 41000 : 0)); setInterval(() => {}, 1000); }, ${delayMs});\n`);
  return file;
};
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a start is timed from spawn to the readiness line, with FORMA_PORT=0 and the child killed afterwards', async () => {
  const fast = await measureStartOnce(process.execPath, { args: [server('fast.mjs', 0)] });
  const slow = await measureStartOnce(process.execPath, { args: [server('slow.mjs', 250)] });
  assert(slow >= 250, `slow start measured ${slow} ms`);
  assert(slow - fast >= 150, `slow ${slow} ms, fast ${fast} ms`);
});

test('a process that exits before announcing, or never announces, is a failure, not a time', async () => {
  const quits = join(dir, 'quits.mjs'); writeFileSync(quits, "console.error('Frontend not built'); process.exit(1);\n");
  await assert.rejects(measureStartOnce(process.execPath, { args: [quits] }), /exited \(1\) before announcing a bound port: Frontend not built/);
  const silent = join(dir, 'silent.mjs'); writeFileSync(silent, 'setInterval(() => {}, 1000);\n');
  await assert.rejects(measureStartOnce(process.execPath, { args: [silent], timeoutMs: 300 }), /did not announce a bound port within 300 ms/);
  await assert.rejects(measureStartOnce(join(dir, 'does-not-exist')), /ENOENT/);
});

test('an artificially slow startup is caught end to end: alternating starts, difference of medians, ceiling', async () => {
  const sample = (forma) => measureStarts(
    { forma: { binary: process.execPath, args: [server(forma, forma === 'slow-template.mjs' ? 130 : 0)] }, baseline: { binary: process.execPath, args: [server('baseline.mjs', 0)] } },
    { runs: 3, warmup: 1 });
  const fine = await sample('fine-template.mjs');
  assert.equal(fine.formaStartMs.length, 3); assert.equal(fine.baselineStartMs.length, 3);
  const fineRow = evaluateN8({ ...base, ...fine });
  assert.equal(fineRow.startOk, true, describeN8(fineRow));
  const slowRow = evaluateN8({ ...base, ...await sample('slow-template.mjs') });
  assert.equal(slowRow.startOk, false, describeN8(slowRow));
  assert.throws(() => assertN8(slowRow), /start: Forma adds/);
});

test('no script that create-app\'s vitest helpers import starts with a shebang (a CRLF `#!` line breaks Vite on Windows)', () => {
  const tests = join(here, '../packages/create-app/tests');
  const imported = new Set(['n8-size-start.mjs']);
  for (const file of ['helpers.ts', 'scaffold.test.ts', 'templates.test.ts', 'scaffold-lib.test.ts', 'server-profile.test.ts', 'template-islands.test.ts', 'docs-truth.test.ts']) {
    for (const [, specifier] of readFileSync(join(tests, file), 'utf8').matchAll(/from '(\.\.\/\.\.\/\.\.\/scripts\/[^']+\.mjs)'/g)) imported.add(resolve(tests, specifier));
  }
  assert(imported.size >= 4, `expected the helpers' script imports, found ${[...imported]}`);
  for (const file of imported) {
    const path = file.includes('/') ? file : join(here, file);
    assert(!readFileSync(path, 'utf8').startsWith('#!'), `${path} starts with a shebang; vitest cannot transform it when a Windows checkout makes the line CRLF`);
  }
  // The same file with CRLF endings, as a Windows checkout writes it, is still a module whose first line is not a shebang.
  assert(!readFileSync(join(here, 'n8-size-start.mjs'), 'utf8').replace(/\n/g, '\r\n').startsWith('#!'));
});

test('a failed baseline build leaves no directory behind, so the next template meets the real error and not "must be fresh"', { skip: process.platform === 'win32' }, () => {
  const bin = join(dir, 'fake-bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\necho "error: could not compile n8-baseline" >&2\nexit 101\n'); chmodSync(join(bin, 'cargo'), 0o755);
  const lock = join(dir, 'Cargo.lock'); writeFileSync(lock, '# lock\n');
  const work = join(dir, 'baseline-work');
  const env = { PATH: `${bin}:${process.env.PATH}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => buildBaseline({ dir: work, lockFile: lock, targetDir: join(dir, 'target'), env }), /N8 baseline build failed \(status 101\):\nerror: could not compile n8-baseline/);
    assert.equal(existsSync(work), false);
  }
});
