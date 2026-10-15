/**
 * The development-only text in the bytes the build emits (FORMA-021 C1 to C3).
 *
 * Every development warning in core is guarded at its site by the build flag
 * `__FORMA_DEV_BUILD__`, in the shape esbuild folds while parsing (see
 * src/reactive/dev.ts). An imported `__DEV__` constant used to guard them
 * instead, and esbuild cannot fold an import across a code-splitting chunk
 * boundary, so dist/index.js and its chunks shipped ten `__DEV__ && warn…`
 * sites with their warning bodies, dead but paid for. The duplicate-instance
 * registry (C3) and the `__FORMA_DEBUG__` console tracing of createShow and
 * createSwitch (C2) shipped in every build.
 *
 * These tests run the real tsup configs, as development-build.test.ts and
 * trusted-html-build.test.ts do, because the folding is the build's, not the
 * source's: the production artifacts carry none of the text, the development
 * twin carries every warning, and the tracing is gone from both.
 */
import { describe, expect, it } from 'vitest';
import { build, type Options } from 'tsup';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rawConfig from '../../tsup.config';
import { DEV_DEFINE } from '../../scripts/build-defines.mjs';

const configs = rawConfig as Options[];

/** Warning text that only the development build may carry, and where it comes from. */
const DEVELOPMENT_ONLY: ReadonlyArray<[text: string, source: string]> = [
  ['Duplicate @getforma/core instance detected', 'reactive/dev.ts, the instance registry (C3)'],
  ['@getforma/core#instances', 'reactive/dev.ts, the registry key (C3)'],
  ['[forma] Dropped ', 'dom/element.ts, a dropped prop'],
  ['createList: duplicate key detected', 'dom/list.ts'],
  ['createList: value is not an array', 'dom/list.ts'],
  ['Refused to write ', 'state/store.ts, a prototype-polluting key'],
  ['the page refused the Trusted Types policy', 'dom/trusted-html.ts'],
];

/** Tracing that no build carries any more (C2): the flag was documented nowhere. */
const REMOVED = ['[forma:switch]', '[forma:show]', '__FORMA_DEBUG__', 'Nested arrays in function children'];

/**
 * Build the tsup config that emits `entries`, narrowed to them, into a private
 * temp dir, and return every JavaScript file it wrote, chunks included, joined.
 */
async function buildAll(entries: string[], overrides: Options = {}): Promise<string> {
  const base = configs.find((c) => c.outDir === 'dist' && entries.every((n) => Object.keys(c.entry as Record<string, string>).includes(n)));
  if (!base) throw new Error(`no production tsup config emits ${entries.join(', ')}`);
  const entry = Object.fromEntries(entries.map((n) => [n, (base.entry as Record<string, string>)[n]]));
  const iife = base.format?.includes('iife') ?? false;
  const outDir = mkdtempSync(join(tmpdir(), 'forma-dev-fold-'));
  try {
    await build({
      ...base,
      config: false,
      entry,
      format: iife ? ['iife'] : ['esm'],
      dts: false,
      sourcemap: false,
      silent: true,
      outDir,
      ...overrides,
    });
    return (readdirSync(outDir, { recursive: true }) as string[])
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(outDir, name), 'utf8'))
      .join('\n');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe('development-only text in the built artifacts (FORMA-021)', () => {
  it('the production code-split entries carry no development warning text, and the development twin carries every one', { timeout: 180_000 }, async () => {
    const production = await buildAll(['index', 'runtime']);
    for (const [text, source] of DEVELOPMENT_ONLY) expect(production, `production: ${source}`).not.toContain(text);
    for (const text of REMOVED) expect(production, `production: ${text}`).not.toContain(text);
    // No guard survives either: the identifier is gone from the code-split
    // graph, where `__DEV__ && …` sites used to cross the chunk boundary.
    expect(production).not.toMatch(/\b__DEV__\d*\b/);
    // The warnings' bodies went with their guards, not only the texts.
    expect(production).not.toContain('warnDropped');
    expect(production).not.toContain('warnForbiddenKey');
    expect(production).not.toContain('registerInstance');

    const development = await buildAll(['index', 'runtime'], { define: { ...DEV_DEFINE } });
    for (const [text, source] of DEVELOPMENT_ONLY) expect(development, `development: ${source}`).toContain(text);
    for (const text of REMOVED) expect(development, `development: ${text}`).not.toContain(text);
  });

  it('the CDN bundles and the runtime IIFEs carry none of the development or debug text either', { timeout: 180_000 }, async () => {
    // The browser ESM bundle (core with h(), Rollup-treeshaken), the two
    // runtime IIFEs (the standard one has no Rollup pass, so only esbuild's
    // own folding removes the text) and the preview frame's runtime.
    for (const entries of [['forma.esm'], ['formajs-runtime'], ['formajs-runtime-hardened'], ['formajs-frame']]) {
      const code = await buildAll(entries);
      for (const [text, source] of DEVELOPMENT_ONLY) expect(code, `${entries[0]}: ${source}`).not.toContain(text);
      for (const text of REMOVED) expect(code, `${entries[0]}: ${text}`).not.toContain(text);
      expect(code, `${entries[0]}: the registry`).not.toContain('registerInstance');
    }
  });
});
