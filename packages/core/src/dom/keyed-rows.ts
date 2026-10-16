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
  readonly get: () => T;
  current: T;
  publish(next: T): void;
}
type Source<T> = () => Entry<T>[];
const sources = new WeakMap<object, Source<unknown>>();

/** Private nominal lookup: plain objects with similarly named methods are never a collection. */
export function keyedRowsSource<T>(value: unknown): Source<T> | undefined {
  return value !== null && typeof value === 'object' ? sources.get(value) as Source<T> | undefined : undefined;
}

function canonical(value: unknown): string {
  const key = canonicalKeyText(value);
  if (key === undefined) throw new TypeError('createKeyedRows: key must be a well-formed string or safe integer');
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
    if (validating) throw new TypeError('createKeyedRows: key validation cannot reenter collection mutation');
    validating = true;
    try { return untrack(read); } finally { validating = false; }
  };
  const candidate = (items: readonly T[]) => validate(() => {
    if (!Array.isArray(items)) throw new TypeError('createKeyedRows: items must be a dense array');
    const copy: T[] = [], keys: string[] = [], seen = new Set<string>();
    // Check the source before copying: slice would fill a hole from an inherited
    // indexed property and incorrectly turn a sparse input into an admitted array.
    for (let i = 0, length = items.length; i < length; i++) {
      if (!Object.hasOwn(items, i)) throw new TypeError('createKeyedRows: items must be a dense array');
      copy.push(items[i]!);
    }
    for (let i = 0; i < copy.length; i++) {
      const key = canonical(keyFn(copy[i]!));
      if (seen.has(key)) throw new TypeError('createKeyedRows: duplicate canonical key');
      seen.add(key); keys.push(key);
    }
    return { items: copy, keys };
  });
  const entry = (key: string, current: T): Entry<T> => {
    // Internal data signals are deliberately not createSignal sites. They grant
    // no compiler capture/enrollment or editable-control writeback authority.
    const value = signal(current);
    return { key, current, get: value, publish: next => value(next) };
  };
  const first = candidate(initial);
  let entries = new Map(first.items.map((item, i) => [first.keys[i]!, entry(first.keys[i]!, item)]));
  const ordered = signal([...entries.values()]);
  const handle = Object.freeze({
    set(key: string | number, next: T): void {
      const selected = validate(() => {
        const keyText = canonical(key), selected = entries.get(keyText);
        if (!selected) throw new TypeError('createKeyedRows: cannot replace a missing key');
        if (canonical(keyFn(next)) !== keyText) throw new TypeError('createKeyedRows: replacement changes its canonical key');
        return selected;
      });
      if (Object.is(selected.current, next)) return;
      selected.current = next; selected.publish(next);
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
        for (const [prior, item] of changed) { prior.current = item; prior.publish(item); }
        ordered([...planned.values()]);
      });
    },
  }) as KeyedRows<T>;
  sources.set(handle, ordered as Source<unknown>);
  return handle;
}
