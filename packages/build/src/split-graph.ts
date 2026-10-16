import type { Metafile } from 'esbuild';
import { basename, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import type { BuildEntry } from './types.js';

export interface SplitGraph {
  /** Logical entry names and all emitted chunks map to their existing graph-safe filenames. */
  assets: Record<string, string>;
  staticDependencies: Record<string, string[]>;
  files: Set<string>;
}

/** esbuild hashes depend on linked chunks. Renaming those files afterward breaks
 * both static and dynamic imports; preserve this graph as one immutable unit. */
export function splitGraph(meta: Metafile, entries: BuildEntry[], outputDir: string,
  browserEntries: ReadonlySet<string> = new Set(entries.map(entry => entry.outfile)),
  entryIdentities: ReadonlyMap<string,string> = new Map(),
): SplitGraph {
  const assets: Record<string, string> = {};
  const files = new Set<string>();
  const outputs = new Map(Object.entries(meta.outputs).map(([path, value]) => [resolve(path), { file: basename(path), value }]));
  const entryOutputs = new Map<string, string>();
  const virtualIdentities = new Set(entryIdentities.values());
  for (const [path, output] of outputs) {
    if (resolve(outputDir, output.file) !== path) throw new Error('Split build emitted a nested output; the manifest requires flat asset filenames.');
    if (!output.value.entryPoint || !output.file.endsWith('.js')) continue;
    const entry = entries.find(candidate => (entryIdentities.has(candidate.outfile)
      ? entryIdentities.get(candidate.outfile) === output.value.entryPoint
      : !virtualIdentities.has(output.value.entryPoint!) && realpathSync(candidate.entry) === realpathSync(resolve(output.value.entryPoint!)))
      && (output.file === candidate.outfile || output.file.startsWith(`${basename(candidate.outfile, '.js')}.`)));
    if (entry) entryOutputs.set(entry.outfile, path);
  }
  // Classification never excuses a missing bundle candidate. Preserve all
  // non-JS output, including CSS/fonts referenced only by a static entry.
  const retained = new Set<string>();
  const retain = (path: string): void => {
    if (retained.has(path)) return;
    const output = outputs.get(path);
    if (!output) throw new Error(`Split build references missing output ${path}.`);
    retained.add(path);
    for (const dependency of output.value.imports) {
      if (!dependency.external) retain(resolve(dependency.path));
    }
  };
  for (const entry of entries) {
    const path = entryOutputs.get(entry.outfile);
    if (!path) throw new Error(`Split build is missing entry ${entry.outfile}.`);
    if (browserEntries.has(entry.outfile)) retain(path);
  }
  for (const [path, output] of outputs) if (!output.file.endsWith('.js')) retain(path);
  for (const path of retained) {
    const file = outputs.get(path)!.file;
    files.add(file); assets[file] = file;
  }
  for (const entry of entries) {
    if (browserEntries.has(entry.outfile)) assets[entry.outfile] = outputs.get(entryOutputs.get(entry.outfile)!)!.file;
  }
  const staticDependencies: Record<string, string[]> = {};
  for (const entry of entries) {
    if (!browserEntries.has(entry.outfile)) continue;
    const entryPath = entryOutputs.get(entry.outfile);
    if (!entryPath) throw new Error(`Split build is missing entry ${entry.outfile}.`);
    const visited = new Set<string>([entryPath]);
    const files: string[] = [];
    const visit = (path: string) => {
      const output = outputs.get(path);
      if (!output) throw new Error(`Split build references missing output ${path}.`);
      for (const dependency of output.value.imports) {
        if (dependency.external || dependency.kind === 'dynamic-import') continue;
        const dependencyPath = resolve(dependency.path);
        if (visited.has(dependencyPath)) continue;
        visited.add(dependencyPath);
        const imported = outputs.get(dependencyPath);
        if (!imported) throw new Error(`Split build references missing dependency ${dependency.path}.`);
        files.push(imported.file);
        visit(dependencyPath);
      }
    };
    visit(entryPath);
    staticDependencies[assets[entry.outfile]] = files;
  }
  return { assets, staticDependencies, files };
}
