import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_BUILD_FLAG, FRAME_DEFINE, PROD_DEFINE } from '../../../scripts/build-defines.mjs';
import { internalEffect, withAdoptionEffectFailure } from '../effect.js';
import { createSignal } from '../signal.js';
import { getAdoptionEvents, withAdoptionEvents } from '../adoption-events.js';
import { onError } from '../dev.js';

type Probe = {
  internalEffect: typeof internalEffect;
  createSignal: typeof createSignal;
  onError: typeof onError;
  getAdoptionEvents: typeof getAdoptionEvents;
  withAdoptionEvents: typeof withAdoptionEvents;
  withAdoptionEffectFailure: typeof withAdoptionEffectFailure;
};
const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
async function bundle(define: Record<string, string>, context = true) {
  const result = await build({
    stdin: {
      contents: `export {internalEffect${context ? ',withAdoptionEffectFailure' : ''}} from './effect';
        export {createSignal} from './signal'; export {onError} from './dev';
        ${context ? "export {getAdoptionEvents,withAdoptionEvents} from './adoption-events';" : ''}`,
      resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      sourcefile: 'frame-effect-probe.ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    minifySyntax: true, define, logLevel: 'silent',
  });
  const code = result.outputFiles[0]!.text;
  const probe = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Probe;
  return { code, probe };
}
function contextReads(probe: Probe) {
  const seen: unknown[] = [], [value, setValue] = probe.createSignal(0);
  const wrap = (listener: EventListenerOrEventListenerObject): EventListener => event => {
    if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
  };
  probe.withAdoptionEvents(wrap, () => {
    disposers.push(probe.internalEffect(() => { value(); seen.push(probe.getAdoptionEvents()); }));
  });
  seen.length = 0; setValue(1);
  return { seen, wrap };
}

describe('frame internal-effect capability', () => {
  it('keeps the frame reader reactive and disposable without linking the unused adoption effect graph', async () => {
    const {code, probe} = await bundle({...FRAME_DEFINE}, false);
    const seen: number[] = [], [value, setValue] = probe.createSignal(1);
    const dispose = probe.internalEffect(() => seen.push(value())); disposers.push(dispose);
    setValue(2); dispose(); setValue(3);
    expect(seen).toEqual([1, 2]);
    expect(code).not.toContain('createEffectNow');
    expect(code).not.toContain('withAdoptionEvents');
    expect(code).not.toContain('createEffect exceeded');
  });

  it('does not retain an otherwise unreachable adoption event context in the frame reader', async () => {
    const {probe} = await bundle({...FRAME_DEFINE});
    expect(contextReads(probe).seen).toEqual([undefined]);
  });

  it('retains the exact event context in normal production readers', async () => {
    const {probe} = await bundle({...PROD_DEFINE}), {seen, wrap} = contextReads(probe);
    expect(seen).toEqual([wrap]);
  });

  it('retains the exact event context when tooling omits the frame define', async () => {
    const {probe} = await bundle({[DEV_BUILD_FLAG]: 'false'}), {seen, wrap} = contextReads(probe);
    expect(seen).toEqual([wrap]);
  });

  it('retains the exact event context in raw source readers', () => {
    const {seen, wrap} = contextReads({internalEffect,createSignal,onError,getAdoptionEvents,withAdoptionEvents,withAdoptionEffectFailure});
    expect(seen).toEqual([wrap]);
  });

  it('preserves frame initial throws and later failure isolation for ordinary readers', async () => {
    const {probe} = await bundle({...FRAME_DEFINE}, false), initial = new Error('initial'), later = new Error('later');
    expect(() => probe.internalEffect(() => {throw initial;})).toThrow(initial);
    const errors: unknown[] = [], sibling: number[] = [], [value,setValue] = probe.createSignal(0);
    disposers.push(probe.onError((error,source) => errors.push([error,source])));
    disposers.push(probe.internalEffect(() => {if(value()) throw later;}));
    disposers.push(probe.internalEffect(() => sibling.push(value())));
    expect(() => setValue(1)).not.toThrow();
    expect(errors).toEqual([[later,{source:'binding'}]]); expect(sibling).toEqual([0,1]);
  });

  it('keeps the normal adopted failure callback instead of the ordinary reader reporter', async () => {
    const {probe} = await bundle({...PROD_DEFINE}), failures: unknown[] = [], reported: unknown[] = [];
    const [value,setValue] = probe.createSignal(0), cause = new Error('adopted');
    disposers.push(probe.onError(error => reported.push(error)));
    probe.withAdoptionEffectFailure(error => failures.push(error), () => {
      disposers.push(probe.internalEffect(() => {if(value()) throw cause;}));
    });
    setValue(1); expect(failures).toEqual([cause]); expect(reported).toEqual([]);
  });
});
