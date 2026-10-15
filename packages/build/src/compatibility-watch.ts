import type { Plugin } from 'esbuild';
import { dirname, join, resolve } from 'node:path';

/** An empty injected input makes Cargo metadata changes participate in esbuild's watcher. */
export function compatibilityGuard(start: string, check: () => void): Plugin {
  const watchFiles: string[] = [];
  for (let directory = resolve(start);; directory = dirname(directory)) {
    watchFiles.push(join(directory, 'Cargo.lock'), join(directory, 'Cargo.toml'));
    if (dirname(directory) === directory) break;
  }
  return {
    name: 'forma-compatibility',
    setup(builder) {
      builder.initialOptions.inject = [...(builder.initialOptions.inject ?? []), 'forma:compatibility'];
      builder.onStart(() => { check(); });
      builder.onResolve({filter: /^forma:compatibility$/}, () => ({path: 'metadata', namespace: 'forma-compatibility'}));
      builder.onLoad({filter: /.*/, namespace: 'forma-compatibility'}, () => ({contents: '', loader: 'js', watchFiles}));
    },
  };
}
