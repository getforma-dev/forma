import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, {recursive: true, force: true})));

it('registers existing and missing ancestor metadata even when its first watched build is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forma-watch-guard-')); roots.push(root);
  const nested = join(root, 'admin'); mkdirSync(nested);
  const ancestor = join(root, 'Cargo.lock'), nearer = join(nested, 'Cargo.lock');
  const lock = (path: string, version: string) => writeFileSync(path, `version=4\n[[package]]\nname="forma-server"\nversion="${version}"\n`);
  lock(ancestor, '2.9.0');
  const runner = join(root, 'runner.mjs'), outputFile = join(root, 'result.js');
  const guard = fileURLToPath(new URL('../src/compatibility-watch.ts', import.meta.url));
  const compatibility = fileURLToPath(new URL('../src/compatibility.ts', import.meta.url));
  const esbuild = pathToFileURL(createRequire(import.meta.url).resolve('esbuild')).href;
  await build({
    stdin: {contents: `import {context} from ${JSON.stringify(esbuild)};
      import {compatibilityGuard} from ${JSON.stringify(guard)};
      import {checkProjectCompatibility} from ${JSON.stringify(compatibility)};
      const ctx = await context({stdin:{contents:'export const ok = true;'},bundle:true,format:'esm',
        outfile:${JSON.stringify(outputFile)},logLevel:'info',
        plugins:[compatibilityGuard(${JSON.stringify(nested)}, () => checkProjectCompatibility(${JSON.stringify(nested)}, [{name:'build',version:[3,0,0]}], true))]});
      await ctx.watch();`, resolveDir: root},
    outfile: runner, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    external: [esbuild],
  });
  const group = process.platform !== 'win32';
  const child = spawn(process.execPath, [runner], {stdio: ['ignore', 'pipe', 'pipe'], detached: group});
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const completed = () => (output.match(/\[watch\] build finished/g) ?? []).length;
  const wait = async (previous: number) => vi.waitFor(() => {
    expect(child.exitCode, output).toBeNull();
    expect(completed(), output).toBeGreaterThan(previous);
  }, {timeout: 10_000});
  const change = async (update: () => void) => { const count = completed(); update(); await wait(count); };
  try {
    await wait(0);
    expect(output).toContain('incompatible with forma-server 2.9.0');
    await change(() => lock(ancestor, '3.1.0'));
    expect(readFileSync(outputFile, 'utf8')).toContain('ok = true');
    // The nearer candidate did not exist when the watcher started.
    await change(() => lock(nearer, '4.0.0'));
    expect(output).toContain('incompatible with forma-server 4.0.0');
    await change(() => lock(nearer, '3.0.99'));
    expect(readFileSync(outputFile, 'utf8')).toContain('ok = true');
    await change(() => rmSync(nearer));
    await change(() => lock(ancestor, '2.8.0'));
    expect(output).toContain('incompatible with forma-server 2.8.0');
    await change(() => lock(ancestor, '3.0.0'));
    expect(readFileSync(outputFile, 'utf8')).toContain('ok = true');
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      if (group && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
      await exited;
    }
  }
}, 30_000);
