import type { Metafile } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { coreOf } from './preview-frame.js';
import type { BuildDiagnostic } from './types.js';

/** Inspect code actually retained by the bundler, including minified/split output. */
export function duplicateCoreDiagnostic(graphs: readonly Metafile[]): BuildDiagnostic | undefined {
  const roots = new Map<string, Set<string>>();
  const cache = new Map<string, string | undefined>();
  for (const graph of graphs) for (const [output, details] of Object.entries(graph.outputs)) {
    for (const [file, contribution] of Object.entries(details.inputs)) {
      if (contribution.bytesInOutput === 0 || file.startsWith('forma-compatibility:')) continue;
      const root = coreOf(resolve(file), cache);
      if (!root) continue;
      const entries = roots.get(root) ?? new Set<string>();
      entries.add(details.entryPoint ?? output); roots.set(root, entries);
    }
  }
  if (roots.size < 2) return undefined;
  const copies = [...roots.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([root, entries]) => {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    return `${root} (${version}; entries: ${[...entries].sort().join(', ')})`;
  });
  return {
    code: 'BUILD-816', severity: 'warning', page: '', file: '', line: 0, column: 0,
    message: `The build contains ${roots.size} physical copies of @getforma/core: ${copies.join('; ')}`,
    why: 'Each copy has independent reactive state and Trusted Types policy initialization, even when their versions match.',
    fix: 'Deduplicate core, use it as a library peer dependency, and make every entry resolve one physical package.',
  };
}
