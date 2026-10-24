import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { DEV_DEFINE, PROD_DEFINE } from '../../../scripts/build-defines.mjs';

describe('signal name build dependency', () => {
  it.each([
    ['production', PROD_DEFINE, undefined],
    ['development', DEV_DEFINE, 'counter'],
  ] as const)('keeps debug names only in the %s contract', async (mode, define, expected) => {
    const result = await build({
      entryPoints: [resolve('src/reactive/signal.ts')], bundle: true,
      write: false, format: 'esm', platform: 'node', target: 'es2022',
      minifySyntax: true, define: { ...define }, logLevel: 'silent',
    });
    const code = result.outputFiles[0]!.text;
    if (mode === 'production') expect(code).not.toContain('signalNames');
    else expect(code).toContain('signalNames');
    const mod = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const [get, set] = mod.createSignal(1, { name: 'counter' });
    expect(mod.getSignalName(get)).toBe(expected);
    set(2);
    expect(get()).toBe(2);
    expect(mod.getSignalName(null)).toBeUndefined();
  });
});
