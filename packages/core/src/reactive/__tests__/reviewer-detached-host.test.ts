import { afterEach, expect, it, vi } from 'vitest';
import { getBatchDepth } from 'alien-signals';
import { __islandRegistration, preflightIslands } from '../../dom/island-state';
import { __adoptionSignal, __adoptionWritable } from '../adoption-hooks';
import { AdoptionScope } from '../adoption-scope';
import { batch } from '../batch';
import { createComputed } from '../computed';
import { createEffect } from '../effect';
import { createSignal } from '../signal';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); expect(getBatchDepth()).toBe(0); });
function prepared() {
  const h = '1122334455667788';
  const doc = document.implementation.createHTMLDocument();
  doc.head.innerHTML = `<script type="application/json" data-island-state>{"v":1,"s":[],"i":[{"h":"${h}","p":{}}]}</script>`;
  doc.body.innerHTML = `<section data-forma-island="0" data-forma-state="0" data-forma-component="Counter" data-forma-h="${h}"><b>original</b></section>`;
  const Counter = __islandRegistration(() => {}, { h, schema: [[]], mode: 0 });
  const result = preflightIslands({ Counter }, doc)[0]!;
  if ('error' in result) throw result.error;
  const scope = new AdoptionScope(result.value);
  cleanups.push(() => scope.abort());
  return { scope, host: result.value.host };
}

it('a revoked host restores every local seed before a surrounding batch exposes anything', () => {
  const { scope, host } = prepared();
  const original = ['old'];
  const [text, items] = scope.run(() => [
    __adoptionSignal(1, createSignal('old')),
    __adoptionSignal(2, createSignal(original)),
  ] as const);
  const [textRead, itemRead] = scope.run(() => [
    __adoptionWritable(text[0], text[0], 'string', 1),
    __adoptionWritable(items[0], items[0], 'string-array', 2),
  ] as const);
  const live = vi.fn();
  // Read both actual signals in one observer to expose any partially restored pair.
  const pairs: string[] = [];
  cleanups.push(createEffect(() => { pairs.push(`${text[0]()}|${items[0]().join(',')}`); }));
  scope.observe(textRead, live);
  scope.queueEdit(textRead, 'typed'); scope.queueEdit(itemRead, ['edited']); scope.seal();
  batch(() => {
    scope.seed();
    expect([text[0](), items[0]()]).toEqual(['typed', ['edited']]);
    host.remove();
    expect(() => scope.publish()).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(items[0]()).toBe(original);
    expect(text[0]()).toBe('old');
    expect(getBatchDepth()).toBe(1);
  });
  expect(new Set(pairs)).toEqual(new Set(['old|old']));
  expect(live).not.toHaveBeenCalled();
  text[1]('later'); expect(pairs.at(-1)).toBe('later|old');
});

it('a sibling scope cannot adopt a getter even when its setter was also built in that sibling', () => {
  const a = prepared().scope, b = prepared().scope;
  const pairA = a.run(() => __adoptionSignal(7, createSignal('a')));
  const pairB = b.run(() => __adoptionSignal(7, createSignal('b')));
  const wrong = b.run(() => {
    __adoptionSignal(7, [pairA[0], pairB[1]]);
    return __adoptionWritable(pairA[0], pairA[0], 'string', 7);
  });
  expect(() => b.queueEdit(wrong, 'overwrite')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
  expect([pairA[0](), pairB[0]()]).toEqual(['a', 'b']);
  const correct = a.run(() => __adoptionWritable(pairA[0], pairA[0], 'string', 7));
  a.queueEdit(correct, 'kept'); a.seal(); a.seed(); a.publish();
  expect(pairA[0]()).toBe('kept');
});

it('a failed later component construction detaches earlier computed readers and preserves unrelated effects', () => {
  const { scope } = prepared(), [get, set] = createSignal(1);
  const compute = vi.fn(() => get() * 2), value = createComputed(compute), writer = vi.fn();
  scope.run(() => scope.observe(value, writer));
  const neighbor: number[] = [];
  cleanups.push(createEffect(() => { neighbor.push(get()); }));
  expect(() => scope.run(() => {
    scope.observe(() => { value(); throw new Error('second component'); }, writer);
  })).toThrow('second component');
  set(2); set(3);
  expect(compute).toHaveBeenCalledTimes(1);
  expect(writer).not.toHaveBeenCalled();
  expect(neighbor).toEqual([1, 2, 3]);
  expect(scope.phase).toBe('aborted');
});
