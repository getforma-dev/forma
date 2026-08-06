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
 * The heavy gate — npm install, frontend build, `cargo check` — is opt-in
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

export function mkTmpDir(prefix = 'forma-scaffold-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmrf(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Run the built CLI. Never inherits stdio, so a prompt cannot hang the suite. */
export function runCli(args: string[], cwd: string): SpawnSyncReturns<string> {
  if (!fs.existsSync(CLI)) {
    throw new Error(`${CLI} is missing — run \`npm run build\` first (the "pretest" script does this).`);
  }
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    // An empty stdin makes `prompts` give up instead of waiting forever if a
    // future change ever makes one of these paths interactive.
    input: '',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

export function run(cmd: string, args: string[], cwd: string, timeout = 900_000) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

/**
 * Start a scaffolded project's compiled server, hand its first response body
 * to `visit`, and shut it down again. Both templates hard-code
 * `127.0.0.1:3000`, so this is serial by construction.
 */
export async function withServer<T>(
  projectDir: string,
  binaryName: string,
  visit: (body: string, res: Response) => T | Promise<T>,
): Promise<T> {
  const exe = path.join(
    projectDir,
    'target',
    'debug',
    process.platform === 'win32' ? `${binaryName}.exe` : binaryName,
  );
  if (!fs.existsSync(exe)) throw new Error(`server binary missing: ${exe}`);

  const child = spawn(exe, [], { cwd: projectDir, stdio: 'ignore' });
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
    if (!res) throw new Error('server never accepted a connection on 127.0.0.1:3000');
    return await visit(await res.text(), res);
  } finally {
    child.kill();
  }
}
