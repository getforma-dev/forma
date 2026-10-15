import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DEV_BUILD_FLAG, FRAME_DEFINE, PROD_DEFINE } from '../../../scripts/build-defines.mjs';
import { withAdoptionSink } from '../adoption-hooks.js';
import { createSignal } from '../signal.js';

type SignalProbe = {
  createSignal: typeof createSignal;
  withAdoptionSink: typeof withAdoptionSink;
};

async function bundledSignals(define: Record<string, string>): Promise<SignalProbe> {
  const result = await build({
    stdin: {
      contents: `export { createSignal } from './signal.ts';
        export { withAdoptionSink } from './adoption-hooks.ts';`,
      resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      sourcefile: 'frame-capture-probe.ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    minifySyntax: true,
    define,
    logLevel: 'silent',
  });
  const url = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`;
  return await import(/* @vite-ignore */ url) as SignalProbe;
}

function checkSignals(probe: SignalProbe, capture: boolean): void {
  const captured: Array<[unknown, unknown]> = [];
  const pair = probe.withAdoptionSink({ capture: (get, set) => captured.push([get, set]) },
    () => probe.createSignal(1));
  expect(pair).toHaveLength(2);
  expect(pair[0]()).toBe(1);
  if (capture) {
    expect(captured).toHaveLength(1);
    expect(captured[0]![0]).toBe(pair[0]);
    expect(captured[0]![1]).toBe(pair[1]);
  } else {
    expect(captured).toEqual([]);
  }
  pair[1](2);
  expect(pair[0]()).toBe(2);
  pair[1](previous => previous + 3);
  expect(pair[0]()).toBe(5);

  const original = { value: 1 };
  const custom = probe.withAdoptionSink({ capture: (get, set) => captured.push([get, set]) },
    () => probe.createSignal(original, { equals: (a, b) => a.value === b.value }));
  custom[1]({ value: 1 });
  expect(custom[0]()).toBe(original);
  custom[1](previous => ({ value: previous.value + 1 }));
  expect(custom[0]()).toEqual({ value: 2 });
  expect(captured).toHaveLength(capture ? 1 : 0);
}

describe('frame signal capture capability', () => {
  it('omits capture only in the frame while retaining ordinary tuple and setter behavior', async () => {
    checkSignals(await bundledSignals({ ...FRAME_DEFINE }), false);
  });

  it('retains actual getter/setter capture in the normal production build', async () => {
    checkSignals(await bundledSignals({ ...PROD_DEFINE }), true);
  });

  it('retains capture when tooling does not define the frame flag', async () => {
    checkSignals(await bundledSignals({ [DEV_BUILD_FLAG]: 'false' }), true);
  });

  it('retains capture when importing the raw source directly', () => {
    checkSignals({ createSignal, withAdoptionSink }, true);
  });
});
