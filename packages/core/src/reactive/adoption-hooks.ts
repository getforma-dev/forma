/** Private compiler hooks. The adoption planner owns the active sink. */
import type { SignalGetter, SignalSetter } from './signal.js';

export type AdoptionCodec = 'string' | 'number' | 'boolean' | 'string-array';
export interface AdoptionSink {
  capture<T>(get: SignalGetter<T>, set: SignalSetter<T>): void;
  enroll<T>(site: number, pair: [SignalGetter<T>, SignalSetter<T>]): void;
  writable<T>(read: () => T, get: SignalGetter<T>, codec: AdoptionCodec, site: number): () => T;
}

let active: AdoptionSink | undefined;

/** @internal Called by the private planner, not exported by the package. */
export function withAdoptionSink<T>(sink: AdoptionSink, fn: () => T): T {
  const previous = active;
  active = sink;
  try { return fn(); } finally { active = previous; }
}

/** @internal Called only by createSignal for its default-equality pair. */
export function recordAdoptionSignal<T>(get: SignalGetter<T>, set: SignalSetter<T>): void {
  active?.capture(get, set);
}

/** @internal Compiler output: retain the actual tuple and diagnostic site. */
export function __adoptionSignal<T>(site: number, pair: [SignalGetter<T>, SignalSetter<T>]): [SignalGetter<T>, SignalSetter<T>] {
  active?.enroll(site, pair);
  return pair;
}

/** @internal Compiler output: associate this read use with its actual local getter. */
export function __adoptionWritable<T>(read: () => T, get: SignalGetter<T>, codec: AdoptionCodec, site: number): () => T {
  return active?.writable(read, get, codec, site) ?? read;
}
