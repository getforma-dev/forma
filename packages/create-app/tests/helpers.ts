import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { commandInvocation } from '../../../scripts/portable-command.mjs';
import { withOwnedServer } from '../../../scripts/owned-server.mjs';

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
 * Run the built CLI. Never inherits stdio, so a prompt cannot hang the suite.
 * `env` overrides variables, e.g. the user agent the CLI reads to pick a
 * package manager.
 */
export function runCli(args: string[], cwd: string, env: Record<string, string> = {}): SpawnSyncReturns<string> {
  if (!fs.existsSync(CLI)) {
    throw new Error(`${CLI} is missing — run \`npm run build\` first (the test script does this explicitly; install hooks stay disabled).`);
  }
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    // An empty stdin makes `prompts` give up instead of waiting forever if a
    // future change ever makes one of these paths interactive.
    input: '',
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  });
  if (CANDIDATE_CONTEXT && result.status === 0 && args[0] && !args[0].startsWith('-') && !args.includes('--dry-run')) {
    const staged = spawnSync(process.execPath, [candidateScript, 'project', CANDIDATE_CONTEXT, path.resolve(cwd, args[0])], {encoding:'utf8', maxBuffer:64*1024*1024, env:process.env});
    if (staged.status !== 0) return staged;
  }
  return result;
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

/** An owned OS-assigned listener; another server can never satisfy readiness. */
export async function withServer<T>(
  projectDir: string,
  binaryName: string,
  visit: (body: string, res: Response, get: (path: string) => Promise<Response>, output: () => string) => T | Promise<T>,
  { profile = 'debug' }: { profile?: 'debug' | 'release' } = {},
): Promise<T> {
  return withOwnedServer(serverBinary(projectDir, binaryName, profile), [], projectDir,
    async (res: Response, origin: string, output: () => string) =>
      visit(await res.text(), res, route => fetch(origin + route, { signal: AbortSignal.timeout(5_000) }), output));
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
