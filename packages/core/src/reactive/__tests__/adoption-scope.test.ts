import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBatchDepth } from 'alien-signals';
import { __islandRegistration, preflightIslands, type ValidatedIsland } from '../../dom/island-state.js';
import { __adoptionSignal, __adoptionWritable } from '../adoption-hooks.js';
import { AdoptionScope } from '../adoption-scope.js';
import { batch } from '../batch.js';
import { createComputed } from '../computed.js';
import { createEffect, internalEffect } from '../effect.js';
import { onError } from '../dev.js';
import { createSignal } from '../signal.js';

const H = '0123456789abcdef';
const scopes: AdoptionScope[] = [];
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.abort();
  for (const dispose of cleanup.splice(0)) dispose();
  expect(getBatchDepth()).toBe(0);
});

function island(mode: 0 | 1 = 0): ValidatedIsland {
  const doc = document.implementation.createHTMLDocument('adoption seam');
  doc.head.innerHTML = `<script type="application/json" data-island-state>{"v":1,"s":[],"i":[{"h":"${H}","p":{}}]}</script>`;
  doc.body.innerHTML = `<div data-forma-island="0" data-forma-state="0" data-forma-component="Test" data-forma-h="${H}" data-forma-status="pending"><span>server</span></div>`;
  const Test = __islandRegistration(() => {}, { h: H, schema: [[]], mode });
  const result = preflightIslands({ Test }, doc)[0]!;
  if ('error' in result) throw result.error;
  return result.value;
}
function scope(value = island()): AdoptionScope {
  const result = new AdoptionScope(value);
  scopes.push(result);
  return result;
}
function text(initial = 'server', site = 7) {
  const pair = __adoptionSignal(site, createSignal(initial));
  const read = __adoptionWritable(() => pair[0](), pair[0], 'string', site);
  return { pair, read };
}
function publish(target: AdoptionScope): void { target.seal(); target.seed(); target.publish(); }

describe('actual local signal authority', () => {
  it('requires a real preflight object and an SSR registration', () => {
    const checked = island();
    expect(() => new AdoptionScope({ ...checked })).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(() => new AdoptionScope(island(1))).toThrow('FORMA_E_HYDRATE_STRUCTURE');
    checked.host.setAttribute('data-forma-h', 'changed');
    expect(() => new AdoptionScope(checked)).toThrow('FORMA_E_ISLAND_IDENTITY');
  });

  it('exposes a codec only for the exact live local wrapper in its preparing scope',()=>{
    const owner=scope(),foreign=scope(),captured=createSignal('outside');
    const values=owner.run(()=>{
      const local=text();
      return {local,capture:__adoptionWritable(captured[0],captured[0],'string',0)};
    });
    expect(owner.inputCodec(values.local.read)).toBe('string');
    expect(owner.inputCodec(values.local.pair[0])).toBeUndefined();expect(owner.inputCodec(values.capture)).toBeUndefined();
    expect(foreign.inputCodec(values.local.read)).toBeUndefined();expect(values.local.pair[0]()).toBe('server');
    publish(owner);expect(owner.inputCodec(values.local.read)).toBeUndefined();owner.abort();expect(owner.inputCodec(values.local.read)).toBeUndefined();
  });

  it('retains tuple and getter identities without rereading the initializer', () => {
    const target = scope(), initializer = vi.fn(() => 'initial');
    target.run(() => {
      const pair = createSignal(initializer());
      expect(__adoptionSignal(7, pair)).toBe(pair);
      const getAlias = pair[0], read = vi.fn(() => getAlias());
      const bound = __adoptionWritable(read, getAlias, 'string', 8);
      expect(read).not.toHaveBeenCalled();
      expect(bound()).toBe('initial');
      expect(read).toHaveBeenCalledTimes(1);
      target.queueEdit(bound, 'typed');
      expect(pair[0]()).toBe('initial');
      publish(target);
      expect(pair[0]()).toBe('typed');
    });
    expect(initializer).toHaveBeenCalledTimes(1);
  });

  it('keeps two helper calls and repeated branch/list sites separate by actual getter', () => {
    const target = scope();
    const locals = target.run(() => [text(), text(), ...[0, 1].map(() => true ? text() : text('unused'))]);
    expect(new Set(locals.map(local => local.pair[0])).size).toBe(4);
    locals.forEach((local, index) => target.queueEdit(local.read, `typed-${index}`));
    publish(target);
    expect(locals.map(local => local.pair[0]())).toEqual(['typed-0', 'typed-1', 'typed-2', 'typed-3']);
  });

  it('separates islands and restores the outer scope after nested construction', () => {
    const outer = scope(), inner = scope();
    const [a, b, c] = outer.run(() => [text(), inner.run(() => text()), text()]);
    outer.queueEdit(a!.read, 'a'); outer.queueEdit(c!.read, 'c'); inner.queueEdit(b!.read, 'b');
    publish(outer); publish(inner);
    expect([a!.pair[0](), b!.pair[0](), c!.pair[0]()]).toEqual(['a', 'b', 'c']);
    const other = scope();
    expect(() => other.queueEdit(a!.read, 'foreign')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(a!.pair[0]()).toBe('a');
  });

  it('does not enroll captured built-ins or arbitrary callback setters', () => {
    const captured = createSignal('shared'), arbitrary = vi.fn();
    for (const kind of ['capture', 'substituted', 'fake'] as const) {
      const target = scope();
      const read = target.run(() => {
        const pair = kind === 'capture' ? captured : kind === 'fake'
          ? [() => 'fake', arbitrary] as [() => string, (value: string | ((old: string) => string)) => void]
          : [createSignal('local')[0], arbitrary] as [() => string, (value: string | ((old: string) => string)) => void];
        __adoptionSignal(7, pair);
        return __adoptionWritable(() => pair[0](), pair[0], 'string', 7);
      });
      expect(() => target.queueEdit(read, 'typed')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    }
    expect(captured[0]()).toBe('shared');
    expect(arbitrary).not.toHaveBeenCalled();
  });

  it('refuses custom equality without calling it during preparation or seeding', () => {
    const target = scope(), equals = vi.fn(() => { throw new Error('custom code'); });
    const local = target.run(() => {
      const pair = __adoptionSignal(7, createSignal('server', { equals }));
      return { pair, read: __adoptionWritable(() => pair[0](), pair[0], 'string', 7) };
    });
    expect(() => target.queueEdit(local.read, 'typed')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(equals).not.toHaveBeenCalled(); expect(local.pair[0]()).toBe('server');
  });

  it('allows an untouched captured reader but refuses only a detected early edit', () => {
    const [get, set] = createSignal('shared'), target = scope(), write = vi.fn();
    const read = target.run(() => __adoptionWritable(() => get(), get, 'string', 7));
    expect(target.observe(read, write)).toBe('shared');
    publish(target);
    expect(write).not.toHaveBeenCalled();
    set('later'); expect(write).toHaveBeenCalledExactlyOnceWith('later');
    const edited = scope();
    expect(() => edited.queueEdit(read, 'typed')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(get()).toBe('later');
  });

  it('leaves ordinary client tuple, reader and custom-equality behavior unchanged', () => {
    const equals = vi.fn((a: string, b: string) => a === b), pair = createSignal<string>('client', { equals });
    const read = () => pair[0]();
    expect(__adoptionSignal(7, pair)).toBe(pair);
    expect(__adoptionWritable(read, pair[0], 'string', 7)).toBe(read);
    pair[1]('client'); pair[1]('next');
    expect(pair[0]()).toBe('next'); expect(equals).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a disposed wrapper or enroll a signal created after preparation', () => {
    const first = scope(), prior = first.run(() => text()); first.abort();
    const between = text('event'), second = scope();
    second.run(() => __adoptionSignal(7, between.pair));
    expect(() => second.queueEdit(prior.read, 'stale')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    const third = scope();
    expect(() => third.queueEdit(between.read, 'event')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(prior.pair[0]()).toBe('server'); expect(between.pair[0]()).toBe('event');
  });
});

describe('checked seeds and reversible commit', () => {
  it('revokes writable authority when either its creation or use group is disposed', () => {
    for (const disposeCreation of [true, false]) {
      const target = scope(), creation = target.group(() => text());
      const use = target.group(() => __adoptionWritable(creation.value.pair[0], creation.value.pair[0], 'string', 9));
      if (disposeCreation) creation.dispose(); else use.dispose();
      expect(() => target.queueEdit(use.value, 'typed')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
      expect(creation.value.pair[0]()).toBe('server');
    }
  });

  it('refuses a queued seed when its described row is disposed before sealing', () => {
    const target = scope(), row = target.group(() => text());
    target.queueEdit(row.value.read, 'typed'); row.dispose();
    expect(() => target.seal()).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(row.value.pair[0]()).toBe('server');
  });

  it('queues equal shared-getter edits once and refuses conflicts before any assignment', () => {
    const target = scope(), local = target.run(() => text());
    target.queueEdit(local.read, 'a'); target.queueEdit(local.read, 'a');
    expect(() => target.queueEdit(local.read, 'b')).toThrow('FORMA_E_HYDRATE_INPUT_CONFLICT');
    expect(target.phase).toBe('aborted'); expect(local.pair[0]()).toBe('server');
    expect(() => publish(target)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  });

  it.each([
    ['string', '', 'typed'], ['number', 0, 3.5], ['boolean', false, true], ['string-array', ['a'], ['b', 'c']],
  ] as const)('seeds the explicit %s codec without converting the live value', (codec, initial, next) => {
    const target = scope();
    const pair = target.run(() => __adoptionSignal(7, createSignal<unknown>(initial)));
    const read = target.run(() => __adoptionWritable(pair[0], pair[0], codec, 7));
    target.queueEdit(read, next); publish(target);
    expect(pair[0]()).toEqual(next);
  });

  it.each([NaN, Infinity, '', null, () => 7])('refuses nonnumeric seeds without invoking them: %s', value => {
    const target = scope(), pair = target.run(() => __adoptionSignal(7, createSignal(3)));
    const read = target.run(() => __adoptionWritable(pair[0], pair[0], 'number', 7));
    expect(() => target.queueEdit(read, value)).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(pair[0]()).toBe(3);
  });

  it('copies queued arrays and detects a changed original array before seeding', () => {
    const target = scope(), initial = ['a'];
    const pair = target.run(() => __adoptionSignal(7, createSignal(initial)));
    const read = target.run(() => __adoptionWritable(pair[0], pair[0], 'string-array', 7));
    const next = ['b']; target.queueEdit(read, next); next[0] = 'outside';
    publish(target); expect(pair[0]()).toEqual(['b']);
    const changed = scope(), local = changed.run(() => {
      const pair = __adoptionSignal(7, createSignal(initial));
      return { pair, read: __adoptionWritable(pair[0], pair[0], 'string-array', 7) };
    });
    changed.queueEdit(local.read, ['c']); changed.seal(); initial[0] = 'changed';
    expect(() => changed.seed()).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(local.pair[0]()).toEqual(['changed']);
  });

  it.each([{ next: [1] }, { next: [undefined] }, { next: new Array(1) }])('refuses a string-array with a non-string position: %j', ({ next }) => {
    const target = scope(), pair = target.run(() => __adoptionSignal(7, createSignal(['server'])));
    const read = target.run(() => __adoptionWritable(pair[0], pair[0], 'string-array', 7));
    expect(() => target.queueEdit(read, next)).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(pair[0]()).toEqual(['server']);
  });

  it('rolls back built-in assignments before releasing the batch', () => {
    const target = scope(), local = target.run(() => text());
    const observed: string[] = [];
    cleanup.push(createEffect(() => { observed.push(local.pair[0]()); }));
    target.queueEdit(local.read, 'typed'); target.seal(); target.seed();
    expect(local.pair[0]()).toBe('typed'); expect(observed).toEqual(['server']);
    target.abort();
    expect(local.pair[0]()).toBe('server'); expect(observed.every(value => value === 'server')).toBe(true);
    expect(getBatchDepth()).toBe(0); target.abort();
    local.pair[1]('later'); expect(observed.at(-1)).toBe('later');
  });

  it('restores the exact original array reference on abort', () => {
    const target = scope(), original = ['server'];
    const pair = target.run(() => __adoptionSignal(7, createSignal(original)));
    const read = target.run(() => __adoptionWritable(pair[0], pair[0], 'string-array', 7));
    target.queueEdit(read, ['typed']); target.seal(); target.seed(); target.abort();
    expect(pair[0]()).toBe(original);
  });

  it('rechecks the document claim before publishing and rolls back a refusal', () => {
    const checked = island(), target = scope(checked), local = target.run(() => text());
    const write = vi.fn(); target.observe(local.read, write);
    target.queueEdit(local.read, 'typed'); target.seal(); target.seed();
    checked.host.setAttribute('data-forma-h', 'changed');
    expect(() => target.publish()).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(target.phase).toBe('aborted'); expect(local.pair[0]()).toBe('server');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('dormant dependencies and abort ownership', () => {
  it('reads once before publication and enables its writer only for later notifications', () => {
    const target = scope(), local = target.run(() => text()), read = vi.fn(local.read), write = vi.fn();
    expect(target.observe(read, write)).toBe('server');
    expect(read).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
    target.seal(); target.seed(); expect(write).not.toHaveBeenCalled(); target.publish();
    expect(read).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
    local.pair[1]('next'); expect(read).toHaveBeenCalledTimes(2); expect(write).toHaveBeenCalledExactlyOnceWith('next');
  });

  it('invalidates on an ordinary preparation notification without rereading or writing', () => {
    const target = scope(), local = target.run(() => text()), read = vi.fn(local.read), write = vi.fn();
    target.observe(read, write); local.pair[1]('changed');
    expect(read).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
    expect(() => target.seal()).toThrow('FORMA_E_HYDRATE_VALUE');
    local.pair[1]('again'); expect(read).toHaveBeenCalledTimes(1);
  });

  it('refuses a pending dependency inside an outer batch before it can publish', () => {
    const target = scope(), local = target.run(() => text()), read = vi.fn(local.read), write = vi.fn();
    target.observe(read, write);
    batch(() => { local.pair[1]('changed'); expect(() => target.seal()).toThrow('FORMA_E_HYDRATE_VALUE'); });
    expect(target.phase).toBe('aborted'); expect(read).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
  });

  it('a throwing first reader removes its partial computed dependency', () => {
    const target = scope(), [get, set] = createSignal(0), compute = vi.fn(() => get());
    const value = createComputed(compute), write = vi.fn();
    expect(() => target.observe(() => { value(); throw new Error('reader'); }, write)).toThrow('reader');
    expect(compute).toHaveBeenCalledTimes(1); set(1); set(2);
    expect(compute).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
    expect(target.phase).toBe('aborted');
  });

  it('disposes an in-progress reader when preparation aborts inside that reader', () => {
    const target = scope(), [get, set] = createSignal(0), compute = vi.fn(() => get());
    const value = createComputed(compute), write = vi.fn();
    expect(() => target.observe(() => { value(); target.abort(); return 0; }, write)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
    set(1); set(2);
    expect(compute).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
  });

  it('a component throw disposes prior and partially constructed readers', () => {
    const target = scope(), [get, set] = createSignal(0), compute = vi.fn(() => get());
    const value = createComputed(compute), prior = vi.fn(), partial = vi.fn();
    expect(() => target.run(() => {
      target.observe(() => { prior(); return value(); }, vi.fn());
      internalEffect(() => { partial(); value(); throw new Error('component'); });
    })).toThrow('component');
    set(1); set(2);
    expect(compute).toHaveBeenCalledTimes(1); expect(prior).toHaveBeenCalledTimes(1); expect(partial).toHaveBeenCalledTimes(1);
    const next = scope(), local = next.run(() => text()); next.queueEdit(local.read, 'next'); publish(next);
    expect(local.pair[0]()).toBe('next');
  });

  it('restores the outer preparation sink when a nested component throws', () => {
    const outer = scope(), inner = scope();
    const local = outer.run(() => {
      expect(() => inner.run(() => { text('inner'); throw new Error('inner'); })).toThrow('inner');
      return text('outer');
    });
    outer.queueEdit(local.read, 'typed'); publish(outer);
    expect(local.pair[0]()).toBe('typed'); expect(inner.phase).toBe('aborted');
  });

  it('keeps a neighboring observer live after a post-commit reader failure', () => {
    const target = scope(), [get, set] = createSignal(0), errors: unknown[] = [], neighbor: number[] = [];
    cleanup.push(onError(error => { errors.push(error); }));
    target.observe(() => { const n = get(); if (n) throw new Error('later'); return n; }, vi.fn());
    cleanup.push(createEffect(() => { neighbor.push(get()); }));
    publish(target); set(1); set(2);
    expect(target.phase).toBe('aborted'); expect(errors).toHaveLength(1); expect(neighbor).toEqual([0, 1, 2]);
  });

  it('changes no host content, attributes or node identity during this private seam', () => {
    const checked = island(), target = scope(checked), before = checked.host.outerHTML, child = checked.host.firstChild;
    const observer = new MutationObserver(() => {}); observer.observe(checked.host, { subtree: true, attributes: true, childList: true, characterData: true });
    const local = target.run(() => text()); target.observe(local.read, vi.fn()); publish(target); target.abort();
    expect(checked.host.outerHTML).toBe(before); expect(checked.host.firstChild).toBe(child); expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });
});
