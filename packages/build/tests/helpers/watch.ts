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
import { spawn } from 'node:child_process';
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

export async function watching(config: BuildConfig, body: (watcher: Watcher) => Promise<void>, cwd?: string): Promise<void> {
  const runner = join(config.outputDir, '..', `watch-runner-${process.pid}.mjs`);
  await bundleBuildRunner(runner);
  // On POSIX the child leads its own process group, so the kill below also
  // reaches the esbuild service it starts, which otherwise can still be
  // writing into the output directory while the test removes it (ENOTEMPTY).
  const group = process.platform !== 'win32';
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {build} from ${JSON.stringify(pathToFileURL(runner).href)}; await build(${JSON.stringify({ app: 'fixture', ...config, watch: true })});`], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: group });
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
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      if (group && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
      await exited;
    }
  }
}
