/**
 * Run `build({ ...config, watch: true })` in a child process for the length
 * of a test body. Watch mode never returns its esbuild contexts, so an
 * in-process watcher would outlive the test; a child is killed afterwards.
 *
 * The child runs `src/build.ts` bundled together with the compiler's source,
 * so a watched SSR build emits real FMIR from this checkout. Fixtures use
 * `.ts` with `h()` calls rather than `.tsx`: the compiler resolves esbuild for
 * its JSX transform relative to its own module, which is the bundle here.
 */

import { expect, vi } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BuildConfig } from '../../src/types';
import { bundleBuildRunner } from './runner';

export interface Watcher {
  /** The current `manifest.json`, parsed; fails the test if the child died. */
  manifest(): any;
  /** Everything the child has printed so far. */
  output(): string;
  /** Wait for initial watch registration; initial-refusal tests intentionally omit this. */
  ready(): Promise<void>;
  /** Apply a change only between completed watch cycles, then await the next one. */
  change(update: () => void): Promise<void>;
}

/** Stop only this fixture's process tree, then wait for inherited stdio to close.
 * `exit` alone does not imply the esbuild descendant released its handles.
 * https://nodejs.org/api/child_process.html#event-close
 * https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill
 */
export async function stopOwnedWatcher(child: ChildProcess, closed: Promise<unknown>, group: boolean): Promise<void> {
  if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
    try {
      if (group) process.kill(-child.pid, 'SIGTERM');
      else await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 });
    } catch (error) {
      // The process may have exited between the check and the targeted kill.
      if (child.exitCode === null && child.signalCode === null && (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([closed, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`owned watcher ${child.pid} did not close its stdio within 5 seconds`)), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function watching(config: BuildConfig, body: (watcher: Watcher) => Promise<void>, cwd?: string): Promise<void> {
  const runner = join(config.outputDir, '..', `watch-runner-${process.pid}.mjs`);
  await bundleBuildRunner(runner);
  // On POSIX the child leads its own process group, so the kill below also
  // reaches the esbuild service it starts, which otherwise can still be
  // writing into the output directory while the test removes it (ENOTEMPTY).
  const group = process.platform !== 'win32';
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {build} from ${JSON.stringify(pathToFileURL(runner).href)}; await build(${JSON.stringify({ app: 'fixture', ...config, watch: true })});`], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: group });
  const closed = once(child, 'close');
  // Observe spawn errors now while still propagating them during teardown.
  void closed.catch(() => {});
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  // A manifest is written inside onEnd; esbuild installs its watch snapshot
  // afterwards. Mutating from that earlier signal can race the snapshot and
  // make the test's change its new baseline. The completed-cycle marker is
  // emitted after the watch snapshot is captured (later cycles also installed):
  // https://github.com/evanw/esbuild/blob/v0.28.1/pkg/api/watcher.go#L122-L127
  // The initial marker comes from setWatchData, with the initial watch-mode
  // scan already captured: pkg/api/api_impl.go#L1105-L1122 (the earlier rebuild is not watched).
  const completed = () => (output.match(/\[watch\] build finished/g) ?? []).length;
  const watcher: Watcher = {
    manifest: () => {
      expect(child.exitCode, output).toBeNull();
      return JSON.parse(readFileSync(join(config.outputDir, 'manifest.json'), 'utf8'));
    },
    output: () => output,
    ready: async () => vi.waitFor(() => {
      expect(child.exitCode, output).toBeNull();
      expect(output).toContain('[watch] build finished, watching for changes');
    }, {timeout: 10_000}),
    change: async update => {
      const previous = completed();
      update();
      await vi.waitFor(() => {
        expect(child.exitCode, output).toBeNull();
        expect(completed(), output).toBeGreaterThan(previous);
      }, {timeout: 10_000});
    },
  };
  try {
    await body(watcher);
  } finally {
    await stopOwnedWatcher(child, closed, group);
  }
}
