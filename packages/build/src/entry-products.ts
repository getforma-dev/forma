import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { BuildResult as EsbuildResult } from 'esbuild';
import type { SsrEntryProduct } from '@getforma/compiler';
import type { BuildConfig, BuildEntry } from './types.js';

interface BrowserEntryProduct {
  readonly page: string;
  readonly mode: 'browser';
  readonly browserRequired: true;
}
export type EntryProduct = SsrEntryProduct | BrowserEntryProduct;
export type EntryProducts = ReadonlyMap<string, EntryProduct>;
export type ReadSsrProducts = (result: EsbuildResult) => readonly SsrEntryProduct[];

/** A compiler candidate is usable only with the exact configured entry and
 * successful output result. This returns candidates, never accepted state. */
export function entryProducts(config: BuildConfig, entries: readonly BuildEntry[], result: EsbuildResult,
  read: ReadSsrProducts | undefined,
): EntryProducts {
  if (result.errors.length) throw new Error('BUILD-611 cannot classify a failed entry result');
  const expected = entries.filter(entry => config.ssr && entry.ssr !== false);
  if (expected.length && !read) throw new Error('BUILD-809 installed compiler lacks exact-result SSR product metadata');
  const native = read?.(result) ?? [];
  if (native.length !== expected.length) throw new Error('BUILD-611 native product count does not match the configured SSR entries');
  const candidates = new Map<string, EntryProduct>();
  const used = new Set<SsrEntryProduct>();
  for (const entry of entries) {
    const page = basename(entry.outfile, '.js');
    if (!config.ssr || entry.ssr === false) {
      candidates.set(entry.outfile, Object.freeze({ page, mode: 'browser', browserRequired: true }));
      continue;
    }
    const matches = native.filter(product => product.page === page);
    const product = matches[0];
    if (matches.length !== 1 || !product || used.has(product)
      || product.mode !== 'ssr'
      || product.sourceEntry !== realpathSync(config.ssrEntryPoints?.[page] ?? entry.entry)
      || product.browserEntry !== realpathSync(entry.entry)
      || product.irFile !== resolve(config.outputDir, `${page}.ir`)
      || product.browserRequired !== (product.islands.length > 0)) {
      throw new Error(`BUILD-611 native product does not match configured entry ${entry.outfile}`);
    }
    used.add(product); candidates.set(entry.outfile, product);
  }
  return candidates;
}

/** Keep explicitly inlined resources in the output graph. A static route that
 * selects one as its owner is refused separately, rather than called zero-JS. */
export function browserEntries(config: BuildConfig, entries: readonly BuildEntry[], products: EntryProducts): Set<string> {
  return new Set(entries.filter(entry => products.get(entry.outfile)?.browserRequired
    || config.serverInlined?.includes(entry.outfile)).map(entry => entry.outfile));
}
