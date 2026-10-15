import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.join(here, '..');
export const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');
export const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

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
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Run the built CLI. Never inherits stdio, so a prompt cannot hang the suite.
 * `env` overrides variables, e.g. the user agent the CLI reads to pick a
 * package manager.
 */
export function runCli(args: string[], cwd: string, env: Record<string, string> = {}): SpawnSyncReturns<string> {
  if (!fs.existsSync(CLI)) {
    throw new Error(`${CLI} is missing — run \`npm run build\` first (the "pretest" script does this).`);
  }
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    // An empty stdin makes `prompts` give up instead of waiting forever if a
    // future change ever makes one of these paths interactive.
    input: '',
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  });
}

/** Run a command; `env` overrides variables, e.g. `FORMA_STRICT` for a build. */
export function run(cmd: string, args: string[], cwd: string, timeout = 900_000, env: Record<string, string> = {}) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    // `cargo metadata` prints about half a megabyte; the default 1 MiB would
    // kill a larger graph mid-output.
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  });
}

/** A scaffolded project's compiled server, or a thrown error naming the missing path. */
function serverBinary(projectDir: string, binaryName: string): string {
  const exe = path.join(
    projectDir,
    'target',
    'debug',
    process.platform === 'win32' ? `${binaryName}.exe` : binaryName,
  );
  if (!fs.existsSync(exe)) throw new Error(`server binary missing: ${exe}`);
  return exe;
}

/**
 * Start a server with its stdout and stderr captured. `output()` is what it
 * has written so far, without terminal colour codes (tracing's formatter
 * writes them even into a pipe).
 */
function startServer(exe: string, cwd: string) {
  const child = spawn(exe, [], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let written = '';
  const collect = (chunk: Buffer) => {
    written += chunk.toString('utf8');
  };
  child.stdout!.on('data', collect);
  child.stderr!.on('data', collect);
  const output = () => written.replace(/\x1b\[[0-9;]*m/g, '');
  return { child, output };
}

/**
 * Start a scaffolded project's compiled server, hand its first response body
 * to `visit`, and shut it down again. `get` fetches any further path from the
 * same server; `output()` is what the server has logged so far. Both
 * templates hard-code `127.0.0.1:3000`, so this is serial by construction,
 * and it waits for the server to exit, so the next one finds the port free.
 */
export async function withServer<T>(
  projectDir: string,
  binaryName: string,
  visit: (
    body: string,
    res: Response,
    get: (path: string) => Promise<Response>,
    output: () => string,
  ) => T | Promise<T>,
): Promise<T> {
  const { child, output } = startServer(serverBinary(projectDir, binaryName), projectDir);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        res = await fetch('http://127.0.0.1:3000/');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!res) throw new Error(`server never accepted a connection on 127.0.0.1:3000; it wrote:\n${output()}`);
    const get = (route: string) => fetch(`http://127.0.0.1:3000${route}`);
    return await visit(await res.text(), res, get, output);
  } finally {
    child.kill();
    await exited;
  }
}

/**
 * Start a server that must refuse to start, and watch it for at most `ms`:
 * until it exits, or until anything accepts a connection on 127.0.0.1:3000,
 * which is polled the whole time. `code` is its exit code, or null when it was
 * still running and had to be killed; `accepted` says whether the port
 * answered meanwhile.
 */
export async function runRefusingServer(
  projectDir: string,
  binaryName: string,
  ms = 30_000,
): Promise<{ code: number | null; output: string; accepted: boolean }> {
  const { child, output } = startServer(serverBinary(projectDir, binaryName), projectDir);
  let code: number | null | undefined;
  // 'close' fires once the process has exited and its output is drained.
  const closed = new Promise<void>((resolve) =>
    child.once('close', (exitCode) => {
      code = exitCode;
      resolve();
    }),
  );
  let accepted = false;
  const deadline = Date.now() + ms;
  while (code === undefined && !accepted && Date.now() < deadline) {
    try {
      await fetch('http://127.0.0.1:3000/', { signal: AbortSignal.timeout(1_000) });
      accepted = true;
    } catch {
      // Nothing is listening, which is what a refused start looks like.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const running = code === undefined;
  if (running) child.kill();
  await closed;
  return { code: running ? null : (code ?? null), output: output(), accepted };
}
