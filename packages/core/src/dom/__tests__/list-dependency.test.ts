import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMA_ALIAS, PROD_DEFINE } from '../../../scripts/build-defines.mjs';

async function bundle(islands: boolean) {
  const result = await build({
    stdin: {
      contents: `export { h, createList, createSignal, mount${islands ? ', activateIslands' : ''} } from './index';`,
      resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
      sourcefile: 'list-dependency-probe.ts',
    },
    bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser',
    minifySyntax: true, define: { ...PROD_DEFINE }, alias: { ...FORMA_ALIAS },
    metafile: true, logLevel: 'silent',
  });
  return Object.values(result.metafile!.outputs)[0]!.inputs;
}

function bytesFor(inputs: Record<string, { bytesInOutput: number }>, module: string): number {
  return Object.entries(inputs).filter(([name]) => name.endsWith(`src/dom/${module}.ts`))
    .reduce((bytes, [, input]) => bytes + input.bytesInOutput, 0);
}

describe('keyed-list dependency ownership', () => {
  it('does not ship activation or state decoding in a client-only list app', async () => {
    const inputs = await bundle(false);
    expect(bytesFor(inputs, 'list')).toBeGreaterThan(0);
    expect(bytesFor(inputs, 'activate')).toBe(0);
    expect(bytesFor(inputs, 'island-state')).toBe(0);
    expect(bytesFor(inputs, 'adoption')).toBe(0);
  });

  it('retains the activation and state decoder when the app activates islands', async () => {
    const inputs = await bundle(true);
    expect(bytesFor(inputs, 'activate')).toBeGreaterThan(0);
    expect(bytesFor(inputs, 'island-state')).toBeGreaterThan(0);
    expect(bytesFor(inputs, 'adoption')).toBeGreaterThan(0);
  });
});
