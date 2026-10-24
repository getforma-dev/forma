import { describe, expect, it } from 'vitest';
import { h } from '../element';
import { createList } from '../list';
import { createSignal } from '../../reactive/signal';
import { createEffect } from '../../reactive/effect';
import { createRoot } from '../../reactive/root';

describe('list position first read after creation', () => {
  it('starts at the current index after moves and remains reactive', () => {
    const [items, setItems] = createSignal([1, 2, 3]);
    const indexes = new Map<number, () => number>();
    let dispose!: () => void;
    const host = createRoot(stop => {
      dispose = stop;
      return h('ul', null, createList(items, item => item, (item, index) => {
        indexes.set(item, index);
        return h('li', null, item);
      }));
    });
    const nodes = [...host.children];
    setItems([3, 1, 2]);
    const values: number[] = [];
    const stop = createEffect(() => { values.push(indexes.get(1)!()); });
    expect(values).toEqual([1]);
    setItems([2, 3, 1]);
    expect(values).toEqual([1, 2]);
    expect([...host.children]).toEqual([nodes[1], nodes[2], nodes[0]]);
    stop();
    dispose();
  });

  it('updates a position first read inside a binding on a later row generation', () => {
    const [items, setItems] = createSignal([{ id: 1, show: false }, { id: 2, show: false }]);
    let dispose!: () => void;
    const host = createRoot(stop => {
      dispose = stop;
      return h('ul', null, createList(items, item => item.id, (item, index) =>
        h('li', null, item.show ? () => index() : 'hidden'), { updateOnItemChange: 'rerender' }));
    });
    setItems([{ id: 2, show: false }, { id: 1, show: true }]);
    expect(host.textContent).toBe('hidden1');
    setItems([items()[1]!, items()[0]!]);
    expect(host.textContent).toBe('0hidden');
    dispose();
  });
});
