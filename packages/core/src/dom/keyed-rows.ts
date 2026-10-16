import { signal } from 'alien-signals';
import { batch } from '../reactive/batch.js';
import { untrack } from '../reactive/untrack.js';
import { canonicalKeyText } from './key-text.js';

declare const keyedRowsBrand: unique symbol;

/** An indexed collection. `set` replaces an existing item; `replace` changes membership/order. */
export interface KeyedRows<T> {
  readonly [keyedRowsBrand]: true;
  set(key: string | number, next: T): void;
  replace(nextItems: readonly T[]): void;
}

interface Entry<T> {
  readonly key: string;
  readonly value: (next: T) => void;
  readonly get: () => T;
}
type Source<T> = () => Entry<T>[];
const sources = new WeakMap<object, Source<unknown>>();

/** Private nominal lookup: plain objects with similarly named methods are never a collection. */
export function keyedRowsSource<T>(value: unknown): Source<T> | undefined {
  return sources.get(value as object) as Source<T> | undefined;
}

function reject(reason: string): never { throw new TypeError('createKeyedRows: ' + reason); }

function canonical(value: unknown): string {
  return canonicalKeyText(value) ?? reject('invalid key');
}

/**
 * Store items by canonical key. Item replacement notifies only that item's readers;
 * structural replacement validates the entire candidate before publishing any change.
 * Inputs are plain data: direct external mutation is not a notifying replacement.
 */
export function createKeyedRows<T>(initial: readonly T[], keyFn: (item: T) => string | number): KeyedRows<T> {
  let entries = new Map<string, Entry<T>>(), validating = false;
  const validate = <R>(read: () => R): R => {
    if (validating) reject('cannot reenter validation');
    validating = true;
    try { return untrack(read); } finally { validating = false; }
  };
  const candidate = (items: readonly T[]) => validate(() => {
    if (!Array.isArray(items)) reject('expected dense array');
    const copy: T[] = [], planned = new Map<string, Entry<T>>(), changed: [Entry<T>, T][] = [];
    // Copy every own entry before calling any key function. Inherited indices
    // must not conceal sparse input, and a key callback must not change later input.
    for (let i = 0, length = items.length; i < length; i++) {
      if (!Object.hasOwn(items, i)) reject('expected dense array');
      copy.push(items[i]!);
    }
    for (const item of copy) {
      const key = canonical(keyFn(item));
      if (planned.has(key)) reject('duplicate key');
      let prior = entries.get(key);
      if (!prior) {
        // Raw data signals grant no compiler capture or input writeback authority.
        // The public item accessor never exposes their overloaded setter.
        const value = signal(item);
        prior = { key, value, get: () => value() };
      } else if (!Object.is(prior.get(), item)) changed.push([prior, item]);
      planned.set(key, prior);
    }
    return { planned, changed };
  });
  const ordered = signal<Entry<T>[]>([]);
  const handle = Object.freeze({
    set(key: string | number, next: T): void {
      const selected = validate(() => {
        const keyText = canonical(key), selected = entries.get(keyText) ?? reject('missing key');
        if (canonical(keyFn(next)) !== keyText) reject('changed key');
        return Object.is(selected.get(), next) ? undefined : selected;
      });
      selected?.value(next);
    },
    replace(nextItems: readonly T[]): void {
      const { planned, changed } = candidate(nextItems);
      // No user key callback remains. Commit the map and every retained value
      // before flushing any observer, so shared views see one coherent replacement.
      entries = planned;
      batch(() => {
        for (const [prior, item] of changed) prior.value(item);
        ordered([...planned.values()]);
      });
    },
  }) as KeyedRows<T>;
  handle.replace(initial);
  sources.set(handle, ordered as Source<unknown>);
  return handle;
}
