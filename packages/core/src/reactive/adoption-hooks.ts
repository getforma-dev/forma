/** Private compiler hooks. The adoption planner owns the active sink. */
import type { SignalGetter, SignalSetter } from './signal.js';

export type AdoptionCodec = 'string' | 'number' | 'boolean' | 'string-array';
export type DeferredEffect = (fail: (error: unknown) => void) => () => void;
export interface AdoptionSink {
  capture?<T>(get: SignalGetter<T>, set: SignalSetter<T>): void;
  enroll?<T>(site: number, pair: [SignalGetter<T>, SignalSetter<T>]): void;
  writable?<T>(read: () => T, get: SignalGetter<T>, codec: AdoptionCodec, site: number): () => T;
  deferEffect?(start: DeferredEffect): (() => void) | undefined;
}

let active: AdoptionSink | undefined;

/** @internal Called by the private planner, not exported by the package. */
export function withAdoptionSink<T>(sink: AdoptionSink | undefined, fn: () => T): T {
  const previous = active;
  active = sink;
  try { return fn(); } finally { active = previous; }
}

/** @internal Called only by createSignal for its default-equality pair. */
export function recordAdoptionSignal<T>(get: SignalGetter<T>, set: SignalSetter<T>): void {
  active?.capture?.(get, set);
}

/** @internal Compiler output: retain the actual tuple and diagnostic site. */
export function __adoptionSignal<T>(site: number, pair: [SignalGetter<T>, SignalSetter<T>]): [SignalGetter<T>, SignalSetter<T>] {
  active?.enroll?.(site, pair);
  return pair;
}

/** @internal Compiler output: associate this read use with its actual local getter. */
export function __adoptionWritable<T>(read: () => T, get: SignalGetter<T>, codec: AdoptionCodec, site: number): () => T {
  return active?.writable?.(read, get, codec, site) ?? read;
}

/** @internal Public effects stay dormant while the private planner constructs. */
export function deferAdoptionEffect(
  fn: () => void | (() => void),
  start: (fn: () => void | (() => void), fail: (error: unknown) => void) => () => void,
): (() => void) | undefined {
  // The optional call avoids allocating a deferred starter for ordinary effects.
  return active?.deferEffect?.(fail => start(fn, fail));
}

/** Private generic callback context; this module has no DOM dependency. */
export type AdoptionCallbackRunner = <T>(callback:()=>T)=>T;
let callbacks:AdoptionCallbackRunner|undefined;
export function withAdoptionCallbacks<T>(runner:AdoptionCallbackRunner|undefined,fn:()=>T):T {
  const previous=callbacks;callbacks=runner;
  try{return fn();}finally{callbacks=previous;}
}
export function getAdoptionCallbacks():AdoptionCallbackRunner|undefined{return callbacks;}
export function bindAdoptionCallback<T>(fn:()=>T,runner:AdoptionCallbackRunner|undefined):()=>T {
  return ()=>{
    // An ordinary neighbor can be synchronously flushed by a describing
    // factory. It gets mode isolation, never the adopted owner's authority.
    const current=runner??callbacks;
    return current?withAdoptionCallbacks(current,()=>current(fn)):fn();
  };
}
