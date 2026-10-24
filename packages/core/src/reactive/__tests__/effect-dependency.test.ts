import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROD_DEFINE } from '../../../scripts/build-defines.mjs';
import { createEffect, internalEffect, withAdoptionEffectFailure } from '../effect.js';
import { createSignal } from '../signal.js';
import { onCleanup } from '../cleanup.js';
import { onError } from '../dev.js';
import { getAdoptionEvents, withAdoptionEvents } from '../adoption-events.js';

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.restoreAllMocks(); });
async function bundle(publicEffect = false) {
  const result = await build({
    stdin: {
      contents: `export { internalEffect${publicEffect ? ', createEffect' : ''} } from './effect';
        export {createSignal} from './signal'; export {onCleanup} from './cleanup';`,
      resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      sourcefile: 'effect-dependency-probe.ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    minifySyntax: true, define: {...PROD_DEFINE}, logLevel: 'silent',
  });
  const code = result.outputFiles[0]!.text;
  const api = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as {
    internalEffect: typeof internalEffect; createEffect: typeof createEffect;
    createSignal: typeof createSignal; onCleanup: typeof onCleanup;
  };
  return {code, api};
}

describe('internal-effect dependency ownership', () => {
  it('keeps the ordinary runtime reader reactive without retaining the public effect implementation', async () => {
    const {code, api} = await bundle();
    const [value,setValue] = api.createSignal(0), seen: number[] = [];
    const dispose = api.internalEffect(() => seen.push(value())); disposers.push(dispose);
    setValue(1); dispose(); setValue(2);
    expect(seen).toEqual([0,1]);
    expect(code).not.toContain('function createOwnedEffect');
    expect(code).not.toContain('createEffect exceeded');
    expect(code).not.toContain('getActiveSub');
  });

  it('retains generation cleanup when the actual public createEffect entry is bundled', async () => {
    const {code,api} = await bundle(true);
    const [value,setValue] = api.createSignal(0), seen: string[] = [];
    const dispose = api.createEffect(() => {
      const current=value(); seen.push(`run:${current}`);
      api.onCleanup(() => seen.push(`cleanup:${current}`));
    }); disposers.push(dispose);
    setValue(1); dispose(); setValue(2);
    expect(seen).toEqual(['run:0','cleanup:0','run:1','cleanup:1']);
    expect(code).toContain('function createOwnedEffect');
    expect(code).toContain('createEffect exceeded');
  });

  it('restores nested failure delegates after an initial throw and leaves later ordinary readers unprivileged', () => {
    const outer=vi.fn(), inner=vi.fn(), reported=vi.fn(); disposers.push(onError(reported));
    const initial=Error('initial'), outerError=Error('outer later'), ordinaryError=Error('ordinary later');
    const [outerValue,setOuter]=createSignal(0), [plainValue,setPlain]=createSignal(0);
    withAdoptionEffectFailure(outer, () => {
      expect(() => withAdoptionEffectFailure(inner, () => {
        internalEffect(() => {throw initial;});
      })).toThrow(initial);
      disposers.push(internalEffect(() => {if(outerValue())throw outerError;}));
    });
    disposers.push(internalEffect(() => {if(plainValue())throw ordinaryError;}));
    setOuter(1); setPlain(1);
    expect(inner).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledExactlyOnceWith(outerError);
    expect(reported).toHaveBeenCalledExactlyOnceWith(ordinaryError,{source:'binding'});
  });

  it('clears a surrounding delegate while an ordinary effect generation runs and restores it afterward', () => {
    const failure=vi.fn(), reported=vi.fn(); disposers.push(onError(reported));
    const [generation,setGeneration]=createSignal(0), [ordinary,setOrdinary]=createSignal(0), [adopted,setAdopted]=createSignal(0);
    const plainError=Error('unprivileged child'), adoptedError=Error('restored owner');
    disposers.push(createEffect(() => {
      if(generation()) disposers.push(internalEffect(() => {if(ordinary())throw plainError;}));
    }));
    withAdoptionEffectFailure(failure, () => {
      setGeneration(1);
      disposers.push(internalEffect(() => {if(adopted())throw adoptedError;}));
    });
    setOrdinary(1); setAdopted(1);
    expect(reported).toHaveBeenCalledExactlyOnceWith(plainError,{source:'binding'});
    expect(failure).toHaveBeenCalledExactlyOnceWith(adoptedError);
  });

  it('clears an undefined captured listener context during a reader rerun inside an adopted callback', () => {
    const [value,setValue]=createSignal(0), seen:unknown[]=[];
    const wrap=(listener:EventListenerOrEventListenerObject):EventListener => event => {
      if(typeof listener==='function')listener(event);else listener.handleEvent(event);
    };
    disposers.push(internalEffect(() => {value();seen.push(getAdoptionEvents());}));
    withAdoptionEvents(wrap, () => {
      setValue(1);
      expect(getAdoptionEvents()).toBe(wrap);
    });
    expect(seen).toEqual([undefined,undefined]);
    expect(getAdoptionEvents()).toBeUndefined();
  });

  it('installs the captured failure and event context for nested readers created by a later adopted generation', () => {
    const failure=vi.fn(), [generation,setGeneration]=createSignal(0), [nested,setNested]=createSignal(0);
    const events: unknown[] = [], cause=Error('nested generation');
    const wrap=(listener:EventListenerOrEventListenerObject):EventListener => event => {
      if(typeof listener==='function')listener(event);else listener.handleEvent(event);
    };
    withAdoptionEvents(wrap, () => withAdoptionEffectFailure(failure, () => {
      disposers.push(createEffect(() => {
        if(generation()) internalEffect(() => {
          events.push(getAdoptionEvents()); if(nested())throw cause;
        });
      }));
    }));
    setGeneration(1); setNested(1);
    expect(events).toEqual([wrap,wrap]);
    expect(failure).toHaveBeenCalledExactlyOnceWith(cause);
    expect(getAdoptionEvents()).toBeUndefined();
  });

  it('restores the outer delegate after a reentrant error callback creates another adopted reader', () => {
    const nestedFailure=vi.fn(), reported=vi.fn(), [nested,setNested]=createSignal(0), [outer,setOuter]=createSignal(0);
    disposers.push(onError(reported));
    const nestedCause=Error('nested'), outerCause=Error('outer'), trigger=Error('trigger');
    const failure=vi.fn((error:unknown) => {
      if(error===trigger) withAdoptionEffectFailure(nestedFailure, () => {
        disposers.push(internalEffect(() => {if(nested())throw nestedCause;}));
      });
    });
    const [value,setValue]=createSignal(0);
    withAdoptionEffectFailure(failure, () => {
      disposers.push(createEffect(() => {if(value())throw trigger;}));
      setValue(1);
      disposers.push(internalEffect(() => {if(outer())throw outerCause;}));
    });
    setNested(1); setOuter(1);
    expect(failure.mock.calls.map(call=>call[0])).toEqual([trigger,outerCause]);
    expect(nestedFailure).toHaveBeenCalledWith(nestedCause);
    expect(reported).not.toHaveBeenCalled();
  });
});
