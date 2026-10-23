#!/usr/bin/env node
// N8 (FORMA-164; DR-34): Forma adds at most 3 MB to a release binary and at most 100 ms to server start.
//
// The check compares each scaffolded template's release binary, as the template ships it, with a
// minimal Axum baseline built from the same lock, the same toolchain and the same release profile:
//
//   - size   the template binary's bytes minus the baseline's. The template embeds everything Forma
//            built for it (the runtime, the IR modules, the CSS and the manifest) and links forma-ir
//            and forma-server; the baseline embeds one 13-byte page and links neither. The same
//            axum, tokio, rust-embed and tracing graph is on both sides, so the difference is
//            Forma's crates plus Forma's embedded assets. Decimal megabytes (3,000,000 bytes), the
//            stricter reading of "3 MB". Release binaries from one lock and one toolchain are
//            byte-reproducible, so this half is deterministic.
//   - start  the time from just before the process is spawned to the stdout line that announces the
//            bound port (`FORMA_LISTENING http://127.0.0.1:PORT`, printed only after `bind`). Each
//            binary starts WARMUP + RUNS times on an OS-assigned port, alternating baseline and
//            template so machine drift hits both; the first WARMUP starts of each are discarded
//            (cold file cache), and the median of each side is compared. The median, not the mean or
//            the maximum, so one descheduled run on a shared CI runner cannot fail the gate; the
//            real startup cost is a few milliseconds against a 100 ms ceiling, so the margin absorbs
//            ordinary noise while a startup that really gains 100 ms moves every run.
//
// The measurement runs in create-app's scaffold suite (packages/create-app/tests/scaffold.test.ts)
// right after each template's `cargo build --release`, on Linux only, and records one observation per
// template; candidate-scaffold.mjs refuses a Linux report without both. Nothing here compiles Rust
// unless asked to (`buildBaseline`); the threshold and parse logic is covered by
// n8-size-start.test.mjs without a toolchain.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** N8's two ceilings. Bytes are decimal megabytes: 3 MB = 3,000,000. */
export const N8_MAX_ADDED_BYTES = 3_000_000;
export const N8_MAX_ADDED_START_MS = 100;
export const N8_TEMPLATES = ['minimal', 'dashboard'];
export const N8_RUNS = 15;
export const N8_WARMUP = 3;

const LISTENING = /^FORMA_LISTENING http:\/\/127\.0\.0\.1:(\d+)\r?$/m;
const ANSI = /\x1b\[[0-9;]*m/g;

export const n8Name = template => `N8 ${template}: added release-binary size and server start time`;

/** The port from the first readiness line in `output`, or null. */
export function parseListening(output) {
  const match = LISTENING.exec(String(output).replace(ANSI, ''));
  if (!match) return null;
  const port = Number(match[1]);
  return port > 0 && port <= 65535 ? port : null;
}

export function median(values) {
  assert(Array.isArray(values) && values.length > 0 && values.every(Number.isFinite), 'median needs a non-empty list of finite numbers');
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const tenth = value => Math.round(value * 10) / 10;

/** One N8 row from the raw measurements, with both verdicts. Pure: no clock, no filesystem. */
export function evaluateN8({ template, formaBytes, baselineBytes, formaStartMs, baselineStartMs }) {
  for (const [name, value] of [['formaBytes', formaBytes], ['baselineBytes', baselineBytes]]) {
    assert(Number.isInteger(value) && value > 0, `N8 ${template}: ${name} must be a positive byte count`);
  }
  // A baseline at least as large as the template cannot be the template minus Forma; refuse it instead of passing vacuously.
  assert(formaBytes > baselineBytes, `N8 ${template}: the baseline (${baselineBytes} bytes) is not smaller than the template binary (${formaBytes} bytes); the measurement is broken`);
  for (const [name, list] of [['formaStartMs', formaStartMs], ['baselineStartMs', baselineStartMs]]) {
    assert(Array.isArray(list) && list.length > 0 && list.every(value => Number.isFinite(value) && value > 0), `N8 ${template}: ${name} must be a non-empty list of positive durations`);
  }
  const addedBytes = formaBytes - baselineBytes;
  const formaMedian = tenth(median(formaStartMs)), baselineMedian = tenth(median(baselineStartMs));
  const addedStartMs = tenth(median(formaStartMs) - median(baselineStartMs));
  const sizeOk = addedBytes <= N8_MAX_ADDED_BYTES, startOk = addedStartMs <= N8_MAX_ADDED_START_MS;
  return {
    id: 'N8', template, formaBytes, baselineBytes, addedBytes,
    formaStartMs, baselineStartMs, formaStartMedianMs: formaMedian, baselineStartMedianMs: baselineMedian, addedStartMs,
    limits: { addedBytes: N8_MAX_ADDED_BYTES, addedStartMs: N8_MAX_ADDED_START_MS },
    sizeOk, startOk, passed: sizeOk && startOk,
  };
}

const fmt = number => number.toLocaleString('en-US');

/** The human line, for the log and the step summary. */
export function describeN8(row) {
  return `N8 ${row.template}: Forma adds ${fmt(row.addedBytes)} bytes (${(row.addedBytes / 1e6).toFixed(3)} MB; limit ${fmt(row.limits.addedBytes)}) ` +
    `and ${row.addedStartMs} ms to start (template median ${row.formaStartMedianMs} ms, baseline median ${row.baselineStartMedianMs} ms, ` +
    `${row.formaStartMs.length} and ${row.baselineStartMs.length} timed starts; limit ${row.limits.addedStartMs} ms)`;
}

/** Throws a coded message for each ceiling the row passes. */
export function assertN8(row) {
  const failures = [];
  if (!row.sizeOk) failures.push(`size: Forma adds ${fmt(row.addedBytes)} bytes, over N8's ${fmt(row.limits.addedBytes)} (template ${fmt(row.formaBytes)}, baseline ${fmt(row.baselineBytes)})`);
  if (!row.startOk) failures.push(`start: Forma adds ${row.addedStartMs} ms to start, over N8's ${row.limits.addedStartMs} ms (template median ${row.formaStartMedianMs} ms, baseline median ${row.baselineStartMedianMs} ms)`);
  if (failures.length) throw new Error(`N8 ${row.template} exceeded its ceiling. ${failures.join('. ')}`);
  return row;
}

/**
 * The scaffold report must carry one N8 row per template on Linux, re-derived from its raw samples;
 * a stored `passed` flag is never trusted. Other platforms are not measured (CI timing is Linux's).
 */
export function requireN8Observations(observations, platform, templates = N8_TEMPLATES) {
  if (platform !== 'linux') return [];
  return templates.map(template => {
    const found = observations.filter(observation => observation.name === n8Name(template));
    assert.equal(found.length, 1, `${n8Name(template)}: expected exactly one observation, found ${found.length}`);
    const { formaBytes, baselineBytes, formaStartMs, baselineStartMs } = found[0];
    const row = evaluateN8({ template, formaBytes, baselineBytes, formaStartMs, baselineStartMs });
    assert.equal(found[0].template, template);
    return assertN8(row);
  });
}

/** Markdown for the job summary from a scaffold report. */
export function summarizeN8(report) {
  const rows = (report.observations ?? []).filter(observation => observation.id === 'N8');
  if (!rows.length) return `### N8: binary size and start time\n\nNo N8 observation in this report (platform ${report.platform}).\n`;
  const lines = ['### N8: binary size and start time', '', '| Template | Added size (limit 3,000,000 B) | Added start (limit 100 ms) | Template median | Baseline median | Verdict |', '|---|---|---|---|---|---|'];
  for (const row of rows) {
    lines.push(`| ${row.template} | ${fmt(row.addedBytes)} B | ${row.addedStartMs} ms | ${row.formaStartMedianMs} ms | ${row.baselineStartMedianMs} ms | ${row.passed ? 'pass' : 'FAIL'} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Milliseconds from just before spawn to the stdout line announcing the bound port, once per run.
 * `FORMA_PORT=0` asks the OS for a port. The child is killed as soon as it has announced.
 */
export async function measureStartOnce(binary, { cwd, args = [], env = {}, timeoutMs = 30_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    let output = '', announced = false, finished = false, timer;
    const t0 = process.hrtime.bigint();
    const child = spawn(binary, args, { cwd, env: { ...process.env, FORMA_HOST: '127.0.0.1', FORMA_PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      error ? reject(error) : resolvePromise(value);
    };
    child.stdout.on('data', chunk => {
      const at = process.hrtime.bigint();
      output += chunk;
      if (!announced && parseListening(output) !== null) { announced = true; finish(null, Number(at - t0) / 1e6); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => finish(error));
    child.on('close', code => finish(new Error(`N8: ${binary} exited (${code}) before announcing a bound port: ${output.replace(ANSI, '')}`)));
    timer = setTimeout(() => finish(new Error(`N8: ${binary} did not announce a bound port within ${timeoutMs} ms: ${output.replace(ANSI, '')}`)), timeoutMs);
  });
}

/**
 * Alternating warm-up and timed starts of two programs. Returns the timed durations of each, in order.
 * Alternation exposes both to the same drift (thermal state, neighbours on a shared runner).
 */
export async function measureStarts({ forma, baseline }, { runs = N8_RUNS, warmup = N8_WARMUP, measure = measureStartOnce } = {}) {
  assert(Number.isInteger(runs) && runs >= 1 && Number.isInteger(warmup) && warmup >= 0, 'runs and warmup must be integers');
  const formaStartMs = [], baselineStartMs = [];
  for (let i = 0; i < warmup + runs; i++) {
    const base = await measure(baseline.binary, baseline), template = await measure(forma.binary, forma);
    if (i >= warmup) { baselineStartMs.push(base); formaStartMs.push(template); }
  }
  return { formaStartMs, baselineStartMs };
}

const BASELINE_CARGO = `[package]
name = "n8-baseline"
version = "0.0.0"
edition = "2021"
publish = false
resolver = "3"

[workspace]

# The template's own dependency requirements without forma-ir or forma-server, on the template's lock.
[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
rust-embed = "8"
tracing = "0.1"
tracing-subscriber = "0.3"
`;

const BASELINE_MAIN = `// N8's baseline (scripts/n8-size-start.mjs): what a template links and does without Forma.
use axum::{response::Html, routing::get, Router};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "assets/"]
struct Assets;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let page = Assets::get("index.html").expect("the embedded page");
    let app = Router::new().route("/", get(move || async move { Html(page.data.to_vec()) }));
    let port: u16 = match std::env::var("FORMA_PORT") {
        Ok(value) => value.parse().expect("FORMA_PORT is a port"),
        Err(_) => 3000,
    };
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await.unwrap();
    println!("FORMA_LISTENING http://{}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}
`;

/**
 * Builds the baseline in \`dir\` from the template's lock, release profile and (optionally) the same
 * target directory, so shared dependencies are not compiled twice. Returns the binary's path.
 */
export function buildBaseline({ dir, lockFile, targetDir, env = {} }) {
  dir = resolve(dir);
  assert(!existsSync(join(dir, 'Cargo.toml')), 'the N8 baseline directory must be fresh');
  mkdirSync(join(dir, 'src'), { recursive: true }); mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), BASELINE_CARGO);
  writeFileSync(join(dir, 'src/main.rs'), BASELINE_MAIN);
  writeFileSync(join(dir, 'assets/index.html'), '<!doctype html>\n');
  copyFileSync(lockFile, join(dir, 'Cargo.lock'));
  // Not --locked: the template's lock names packages the baseline does not use, and cargo prunes them.
  // --offline: every crate is already in the registry cache from the template's own build.
  const result = spawnSync('cargo', ['build', '--release', '--offline'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(targetDir ? { CARGO_TARGET_DIR: resolve(targetDir) } : {}), CARGO_INCREMENTAL: '0', ...env },
  });
  assert.equal(result.status, 0, `N8 baseline build failed:\n${result.stderr}`);
  const binary = join(targetDir ? resolve(targetDir) : join(dir, 'target'), 'release', process.platform === 'win32' ? 'n8-baseline.exe' : 'n8-baseline');
  assert(existsSync(binary), `N8 baseline binary missing: ${binary}`);
  return binary;
}

/** Measure one template's built release binary against the baseline binary; returns the row (not yet asserted). */
export async function measureTemplate({ template, binary, cwd, baselineBinary, runs = N8_RUNS, warmup = N8_WARMUP }) {
  const { formaStartMs, baselineStartMs } = await measureStarts(
    { forma: { binary, cwd }, baseline: { binary: baselineBinary, cwd } }, { runs, warmup });
  return evaluateN8({ template, formaBytes: statSync(binary).size, baselineBytes: statSync(baselineBinary).size, formaStartMs, baselineStartMs });
}

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'measure') {
    const template = option(args, 'template'), binary = option(args, 'binary'), cwd = option(args, 'cwd');
    assert(template && binary && cwd, 'usage: n8-size-start.mjs measure --template T --binary BIN --cwd DIR (--baseline BIN | --lock Cargo.lock --work DIR [--target-dir DIR]) [--runs N] [--out FILE]');
    const baselineBinary = option(args, 'baseline') ?? buildBaseline({ dir: option(args, 'work'), lockFile: option(args, 'lock'), targetDir: option(args, 'target-dir') });
    const row = await measureTemplate({ template, binary: resolve(binary), cwd: resolve(cwd), baselineBinary: resolve(baselineBinary), runs: Number(option(args, 'runs') ?? N8_RUNS) });
    console.log(describeN8(row));
    if (option(args, 'out')) writeFileSync(option(args, 'out'), `${JSON.stringify({ name: n8Name(template), ...row }, null, 2)}\n`);
    assertN8(row);
  } else if (command === 'summary') {
    process.stdout.write(summarizeN8(JSON.parse(readFileSync(args[0], 'utf8'))));
  } else throw new Error('usage: n8-size-start.mjs measure ... | summary REPORT.json');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
