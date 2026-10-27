import { createHash } from 'node:crypto';
import type { BuildResult, OutputFile } from 'esbuild';

/** One successfully compiled native/browser entry, before caller publication. */
export interface SsrEntryProduct {
  readonly page: string;
  readonly mode: 'ssr';
  readonly sourceEntry: string;
  readonly browserEntry: string;
  readonly irFile: string;
  readonly irHash: string;
  readonly browserRequired: boolean;
  readonly navigationOutlet?: string | null;
  readonly islands: readonly Readonly<{ name: string; mode: 'ssr' | 'browserOnly'; declaration?: string; contract?: string }>[];
}

interface Contribution { readonly product: SsrEntryProduct; readonly output: OutputFile }
const contributions = new WeakMap<BuildResult, readonly Contribution[]>();
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Internal: attach metadata only beside the matching validated output object. */
export function recordSsrEntryProduct(result: BuildResult, output: OutputFile,
  input: Omit<SsrEntryProduct, 'mode' | 'irFile' | 'irHash' | 'browserRequired'>): void {
  const previous = contributions.get(result) ?? [];
  if (previous.some(({ product }) => product.page === input.page || product.irFile === output.path)) {
    throw new Error(`Duplicate SSR product for ${input.page}`);
  }
  const islands = Object.freeze(input.islands.map(island => Object.freeze({ ...island })));
  const product: SsrEntryProduct = Object.freeze({
    page: input.page, mode: 'ssr', sourceEntry: input.sourceEntry, browserEntry: input.browserEntry,
    ...(input.navigationOutlet !== undefined ? { navigationOutlet: input.navigationOutlet } : {}),
    irFile: output.path, irHash: digest(output.contents), browserRequired: islands.length > 0, islands,
  });
  contributions.set(result, Object.freeze([...previous, Object.freeze({ product, output })]));
}

/**
 * Read this exact successful esbuild result's compiler products. Call after
 * `await build()`/`rebuild()`, or from the caller's final guarded onEnd publisher.
 * An earlier onEnd callback is not a successful publication boundary: later
 * plugins may still refuse the build. No callback or mutable onStart state is
 * exposed. The caller commits these records with its output graph/manifest.
 *
 * Browser-only builds have no native products. Callers must independently match
 * every configured SSR entry; absence must never imply static or Browser mode.
 */
export function getSsrEntryProducts(result: BuildResult): readonly SsrEntryProduct[] {
  if (result.errors.length) throw new Error('Cannot consume SSR products from a failed esbuild result');
  const current = contributions.get(result) ?? [];
  for (const { product, output } of current) {
    if (result.outputFiles?.filter(file => file === output).length !== 1
      || result.outputFiles.filter(file => file.path === product.irFile).length !== 1
      || output.path !== product.irFile || digest(output.contents) !== product.irHash) {
      throw new Error(`SSR product IR identity changed for ${product.page}`);
    }
  }
  return Object.freeze(current.map(({ product }) => product));
}
