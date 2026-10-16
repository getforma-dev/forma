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
  current: T;
}
type Source<T> = () => Entry<T>[];
const sources = new WeakMap<object, Source<unknown>>();

/** Private nominal lookup: plain objects with similarly named methods are never a collection. */
export function keyedRowsSource<T>(value: unknown): Source<T> | undefined {
  return value !== null && typeof value === 'object' ? sources.get(value) as Source<T> | undefined : undefined;
}

function reject(reason: string): never { throw new TypeError('createKeyedRows: ' + reason); }

function canonical(value: unknown): string {
  const key = canonicalKeyText(value);
  if (key === undefined) reject('invalid key');
  return key;
}

/**
 * Store items by canonical key. Item replacement notifies only that item's readers;
 * structural replacement validates the entire candidate before publishing any change.
 * Inputs are plain data: direct external mutation is not a notifying replacement.
 */
export function createKeyedRows<T>(initial: readonly T[], keyFn: (item: T) => string | number): KeyedRows<T> {
  let validating = false;
  const validate = <R>(read: () => R): R => {
    if (validating) reject('cannot reenter validation');
    validating = true;
    try { return untrack(read); } finally { validating = false; }
  };
  const candidate = (items: readonly T[]) => validate(() => {
    if (!Array.isArray(items)) reject('expected dense array');
    const copy: T[] = [], keys: string[] = [], seen = new Set<string>();
    // Check the source before copying: slice would fill a hole from an inherited
    // indexed property and incorrectly turn a sparse input into an admitted array.
    for (let i = 0, length = items.length; i < length; i++) {
      if (!Object.hasOwn(items, i)) reject('expected dense array');
      copy.push(items[i]!);
    }
    for (let i = 0; i < copy.length; i++) {
      const key = canonical(keyFn(copy[i]!));
      if (seen.has(key)) reject('duplicate key');
      seen.add(key); keys.push(key);
    }
    return { items: copy, keys };
  });
  const entry = (key: string, current: T): Entry<T> => {
    // Internal data signals are deliberately not createSignal sites. They grant
    // no compiler capture/enrollment or editable-control writeback authority.
    const value = signal(current);
    return { key, current, value, get: () => value() };
  };
  let entries = new Map<string, Entry<T>>();
  const ordered = signal<Entry<T>[]>([]);
  const handle = Object.freeze({
    set(key: string | number, next: T): void {
      const selected = validate(() => {
        const keyText = canonical(key), selected = entries.get(keyText);
        if (!selected) reject('missing key');
        if (canonical(keyFn(next)) !== keyText) reject('changed key');
        return selected;
      });
      if (Object.is(selected.current, next)) return;
      selected.current = next; selected.value(next);
    },
    replace(nextItems: readonly T[]): void {
      const next = candidate(nextItems), planned = new Map<string, Entry<T>>();
      const changed: [Entry<T>, T][] = [];
      for (let i = 0; i < next.items.length; i++) {
        const key = next.keys[i]!, item = next.items[i]!, prior = entries.get(key);
        planned.set(key, prior ?? entry(key, item));
        if (prior && !Object.is(prior.current, item)) changed.push([prior, item]);
      }
      // No user key callback remains. Commit the map and every retained value
      // before flushing any observer, so shared views see one coherent replacement.
      entries = planned;
      batch(() => {
        for (const [prior, item] of changed) { prior.current = item; prior.value(item); }
        ordered([...planned.values()]);
      });
    },
  }) as KeyedRows<T>;
  handle.replace(initial);
  sources.set(handle, ordered as Source<unknown>);
  return handle;
}
