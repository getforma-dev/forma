import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { expect } from 'vitest';
import type { Browser } from '@playwright/test';
import { commandInvocation } from '../../../scripts/portable-command.mjs';
import { withOwnedServer } from '../../../scripts/owned-server.mjs';
import { appendDiagnostics, describeScaffoldDir, formatMs, processSnapshot, timingRow, type TimingRow } from '../../../scripts/scaffold-diagnostics.mjs';
import { assertN8, buildBaseline, describeN8, measureTemplate, n8Name } from '../../../scripts/n8-size-start.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.join(here, '..');
export const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');
export const CLI = process.env.FORMA_SCAFFOLD_CLI ?? path.join(REPO_ROOT, 'dist', 'index.js');
export const CANDIDATE_CONTEXT = process.env.FORMA_SCAFFOLD_CONTEXT;
const candidateScript = path.resolve(REPO_ROOT, '../../scripts/candidate-scaffold.mjs');

/**
 * The heavy gate — npm ci, frontend build, `cargo check --locked` — is opt-in
 * because it needs a network, a Rust toolchain and a few minutes. CI turns it
 * on in a dedicated job; `npm test` on a laptop runs the structural half only.
 */
export const E2E = process.env.FORMA_SCAFFOLD_E2E === '1';

/** Every path under `dir`, relative and POSIX-separated, sorted. */
export function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, base));
    } else {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

/**
 * Project names that `validateProjectName` is held against the tools it cites:
 * npm's own validator in tests/scaffold-lib.test.ts, and `cargo new` itself in
 * the E2E gate in tests/scaffold.test.ts. Every rule has a name here that
 * breaks it, and the accepted names include ones cargo only warns about
 * (`std`, `core`) and crates in the templates' own graph (`tracing`, `axum`).
 */
export const PROJECT_NAMES = [
  // accepted
  'app', 'my-app', 'my_app', 'a', 'x9', 'app0', 'a-0', 'web_app-2', 'app-',
  'minimal', 'tracing', 'axum', 'std', 'core', 'alloc', 'proc_macro', 'proc-macro',
  // npm refuses these for a new package; the project name never becomes one
  'node_modules', 'http', 'fs', 'path', 'events',
  'x'.repeat(64),
  // refused
  '', 'x'.repeat(65), 'My-App', 'C:tricky', '..', '../escape', 'a/b', 'a\\b', '/abs',
  '.hidden', 'has space', 'a.b', 'a::b', 'app!', 'café',
  '0app', '9', '1-app', '-leading', '_leading',
  'fn', 'self', 'type', 'async', 'match',
  'build', 'deps', 'examples', 'incremental', 'test',
  'con', 'nul', 'lpt1', 'com9',
];

export function mkTmpDir(prefix = 'forma-scaffold-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmrf(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/**
 * Each child runCli starts (the CLI, then candidate staging) is bounded by this. Two of them fit the
 * CLI-backed tests' 60s budget. FORMA-252 kept it: in 89 Windows scaffold jobs the 621 CLI-backed
 * tests took p50 0.9s, p90 1.7s, p99 6.8s; all six over 10s came from two jobs whose vitest start was
 * slow, and the one failing job's calls were cut at the limit, so no measured duration supports
 * another figure. The timing rows now measure the calls alone.
 */
export const CLI_TIMEOUT_MS = 25_000;

/** Calls that take this share of their budget are reported even when they pass. */
const SLOW_SHARE = 0.4;

function currentTest(): string | undefined {
  try { return expect.getState().currentTestName; } catch { return undefined; }
}

function recordTiming({ name, ...row }: TimingRow) {
  recordObservation(name, row);
}

/**
 * A timed-out or unspawnable child: how long it ran, how far a scaffold got, what the host was doing.
 * The process snapshot is bounded by SNAPSHOT_TIMEOUT_MS (scripts/scaffold-diagnostics.mjs), sized
 * for a runner as slow as PR152's. Running past a hook's 60s budget does not hide this text: runCli
 * is synchronous, every caller asserts on the result and throws, and vitest 4 keeps a hook's or
 * test's own thrown error even when it ends past its timeout (the elapsed check applies only when
 * it resolves).
 */
function explainChildFailure(phase: string, result: SpawnSyncReturns<string>, ms: number, dest?: string): string {
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  const lines = [`[${phase}] ${code ?? result.error} after ${ms} ms of its ${CLI_TIMEOUT_MS} ms budget (pid ${result.pid}, signal ${result.signal ?? 'none'})`];
  if (dest) lines.push(`[${phase}] destination ${describeScaffoldDir(dest)}`);
  if (code === 'ETIMEDOUT') lines.push(`[${phase}] ${processSnapshot({ parentPid: result.pid })}`);
  return lines.join('\n');
}

/**
 * Run the built CLI. Never inherits stdio, so a prompt cannot hang the suite.
 * `env` overrides variables, e.g. the user agent the CLI reads to pick a
 * package manager. Every call is timed into the scaffold report (FORMA-252);
 * a timeout says how long each child ran and how far the scaffold got.
 */
export function runCli(args: string[], cwd: string, env: Record<string, string> = {}): SpawnSyncReturns<string> {
  if (!fs.existsSync(CLI)) {
    throw new Error(`${CLI} is missing — run \`npm run build\` first (the test script does this explicitly; install hooks stay disabled).`);
  }
  const label = `${currentTest() ?? 'hook'}: create-app ${args.join(' ')}`;
  const dest = args[0] && !args[0].startsWith('-') ? path.resolve(cwd, args[0]) : undefined;
  const started = performance.now();
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
    // An empty stdin makes `prompts` give up instead of waiting forever if a
    // future change ever makes one of these paths interactive.
    input: '',
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  });
  const cliMs = Math.round(performance.now() - started);
  if (result.error) result.stderr = [result.stderr, `scaffold CLI: ${result.error}`, explainChildFailure('scaffold CLI', result, cliMs, dest), result.stdout].filter(Boolean).join('\n');
  const phases: Record<string, number> = { cli: cliMs };
  let outcome = result;
  if (CANDIDATE_CONTEXT && result.status === 0 && args[0] && !args[0].startsWith('-') && !args.includes('--dry-run')) {
    const stagingStarted = performance.now();
    const staged = spawnSync(process.execPath, [candidateScript, 'project', CANDIDATE_CONTEXT, path.resolve(cwd, args[0])], {encoding:'utf8', timeout:CLI_TIMEOUT_MS, maxBuffer:64*1024*1024, env:process.env});
    phases.staging = Math.round(performance.now() - stagingStarted);
    if (staged.error) staged.stderr = [staged.stderr, `candidate project staging: ${staged.error}`, explainChildFailure('candidate project staging', staged, phases.staging), staged.stdout].filter(Boolean).join('\n');
    if (staged.status !== 0) outcome = staged;
  }
  recordTiming(timingRow('scaffold CLI', { label, phases, budgets: { cli: CLI_TIMEOUT_MS, staging: CLI_TIMEOUT_MS }, ok: !outcome.error, status: outcome.status }));
  if (Object.values(phases).some(ms => ms >= CLI_TIMEOUT_MS * SLOW_SHARE)) {
    console.warn(`[scaffold timing] ${label}: ${Object.entries(phases).map(([phase, ms]) => `${phase} ${formatMs(ms)}`).join(', ')} of ${formatMs(CLI_TIMEOUT_MS)} each`);
  }
  return outcome;
}

export function auditSignatures(admin: string) {
  return CANDIDATE_CONTEXT
    ? run(process.execPath, [candidateScript, 'audit', CANDIDATE_CONTEXT, admin], admin)
    : run('npm', ['audit', 'signatures'], admin);
}

export function recordObservation(name: string, details: Record<string, unknown>) {
  const directory = process.env.FORMA_SCAFFOLD_REPORT_DIR;
  if (directory) fs.appendFileSync(path.join(directory, 'observations.jsonl'), JSON.stringify({name, ...details}) + '\n');
}

let n8Baseline: string | undefined;

/**
 * N8 (FORMA-164): after a template's `cargo build --release`, measure what Forma adds to the binary and
 * to server start against a minimal Axum baseline built from the same lock (scripts/n8-size-start.mjs),
 * record the figures in the scaffold report, then fail over 3 MB or 100 ms. Linux only: that is where CI
 * timing is taken; FORMA_N8=1 measures on another platform for a local look (candidate-scaffold.mjs
 * requires the observations on Linux alone).
 */
export async function checkN8(template: string, projectDir: string, binaryName: string) {
  if (process.platform !== 'linux' && process.env.FORMA_N8 !== '1') return;
  const binary = serverBinary(projectDir, binaryName, 'release');
  n8Baseline ??= buildBaseline({
    dir: path.join(path.dirname(projectDir), 'n8-baseline'),
    lockFile: path.join(projectDir, 'Cargo.lock'),
    targetDir: process.env.CARGO_TARGET_DIR ?? path.join(projectDir, 'target'),
  });
  const row = await measureTemplate({ template, binary, cwd: projectDir, baselineBinary: n8Baseline });
  console.log(describeN8(row));
  // Recorded before it can fail, so a failing report still carries the figures.
  recordObservation(n8Name(template), { ...row });
  assertN8(row);
}

/** Run a command; `env` overrides variables, e.g. `FORMA_STRICT` for a build. */
export function run(cmd: string, args: string[], cwd: string, timeout = 900_000, env: Record<string, string> = {}) {
  const invocation = commandInvocation(cmd, args);
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    timeout,
    // `cargo metadata` prints about half a megabyte; the default 1 MiB would
    // kill a larger graph mid-output.
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  });
}

/** A scaffolded project's compiled server, or a thrown error naming the missing path. */
function serverBinary(projectDir: string, binaryName: string, profile: 'debug' | 'release' = 'debug'): string {
  if (profile !== 'debug' && profile !== 'release') throw new Error(`unsupported server profile: ${profile}`);
  const exe = path.join(
    process.env.CARGO_TARGET_DIR ?? path.join(projectDir, 'target'),
    profile,
    process.platform === 'win32' ? `${binaryName}.exe` : binaryName,
  );
  if (!fs.existsSync(exe)) throw new Error(`server binary missing: ${exe}`);
  return exe;
}

/**
 * An owned OS-assigned listener; another server can never satisfy readiness. Its start is timed
 * into the scaffold report: spawn to FORMA_LISTENING, and to the answered readiness GET /.
 */
export async function withServer<T>(
  projectDir: string,
  binaryName: string,
  visit: (body: string, res: Response, get: (path: string) => Promise<Response>, output: () => string) => T | Promise<T>,
  { profile = 'debug' }: { profile?: 'debug' | 'release' } = {},
): Promise<T> {
  return withOwnedServer(serverBinary(projectDir, binaryName, profile), [], projectDir,
    async (res: Response, origin: string, output: () => string, timings) => {
      const { listeningMs, readyMs } = timings();
      recordTiming(timingRow('owned server', { label: `${currentTest() ?? 'server'}: ${binaryName} (${profile})`, phases: { listening: listeningMs ?? NaN, ready: readyMs ?? NaN }, budgets: { listening: 30_000 } }));
      return visit(await res.text(), res, route => fetch(origin + route, { signal: AbortSignal.timeout(5_000) }), output);
    });
}

/**
 * One engine's packed-template browser checks. A failure names the engine and its version, how long
 * the launch and the checks took, and the page timeline release-template-islands.mjs attaches
 * (FORMA-252: the Windows timeouts so far named neither, and the engine had to be inferred from
 * which observations were recorded). Each engine's timing goes to the scaffold report.
 */
export async function withEngine<T>(engine: string, launcher: { launch(): Promise<Browser> }, check: (browser: Browser) => Promise<T>): Promise<T> {
  const label = `${currentTest() ?? 'browser'}: ${engine}`;
  const started = performance.now(), since = () => Math.round(performance.now() - started);
  let browser: Browser;
  try {
    browser = await launcher.launch();
  } catch (error) {
    recordTiming(timingRow(`browser ${engine}`, { label, phases: { launch: since() }, ok: false }));
    throw appendDiagnostics(error, `[browser] ${engine} failed to launch after ${since()} ms`);
  }
  const launchMs = since(), version = browser.version();
  try {
    const result = await check(browser);
    recordTiming(timingRow(`browser ${engine}`, { label, version, phases: { launch: launchMs, checks: since() - launchMs } }));
    return result;
  } catch (error) {
    const checksMs = since() - launchMs;
    recordTiming(timingRow(`browser ${engine}`, { label, version, phases: { launch: launchMs, checks: checksMs }, ok: false }));
    const timeline = (error as { formaTimeline?: string[] } | null)?.formaTimeline;
    throw appendDiagnostics(error, [
      `[browser] ${engine} ${version}: launched in ${launchMs} ms; the check failed ${checksMs} ms after launch`,
      timeline?.length ? `[browser] page timeline (ms after the page opened):\n${timeline.join('\n')}` : '[browser] no page timeline attached',
    ].join('\n'));
  } finally {
    await browser.close();
  }
}

/**
 * Run `body` in a fresh temp dir, then remove it. A failed removal never hides the body's own
 * failure: the PR152 ETIMEDOUT in templates.test.ts surfaced only as the EPERM its cleanup hit.
 */
export function inTmpDir<T>(prefix: string, body: (dir: string) => T): T {
  const dir = mkTmpDir(prefix);
  let result: T;
  try {
    result = body(dir);
  } catch (error) {
    let failure = error;
    try { rmrf(dir); } catch (cleanup) { failure = appendDiagnostics(error, `[cleanup] removing ${dir} also failed: ${cleanup}`); }
    throw failure;
  }
  rmrf(dir);
  return result;
}

/** Refused startup must exit without announcing a successfully bound listener. */
export async function runRefusingServer(
  projectDir: string,
  binaryName: string,
  ms = 30_000,
): Promise<{ code: number | null; output: string; accepted: boolean }> {
  return withOwnedServer(serverBinary(projectDir, binaryName), [], projectDir,
    () => { throw new Error('refused server must not be visited'); }, { refusal: true, timeout: ms });
}
