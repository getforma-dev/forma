import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEffect, createRoot, createSignal, registerDisposer } from '../../reactive';
import { h } from '../element';
import { createList, reconcileList } from '../list';

type Item = { key: string | number; label: string };
type Row = { node: HTMLElement; label: string; reads: number; disposed: number };
const sizes = [8, 31, 32, 33, 64];
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.restoreAllMocks(); });

function items(size: number, duplicates = false): Item[] {
  const keys: (string | number)[] = duplicates
    ? [NaN, NaN, -0, +0, 'same', 'same', 7, 7]
    : [NaN, -0, '0', 7];
  return Array.from({ length: size }, (_, index) => ({ key: keys[index] ?? index + 100, label: `row-${index}` }));
}

function owned(initial: Item[], rerender = false) {
  const [readItems, writeItems] = createSignal(initial);
  const [tick, writeTick] = createSignal(0);
  const rows: Row[] = [];
  let stop!: () => void, turn = 0;
  const container = createRoot(dispose => {
    stop = dispose; stops.push(dispose);
    return h('ul', null, createList(readItems, item => item.key, (item, index) => {
      const row = { label: item.label, reads: 0, disposed: 0 } as Row;
      rows.push(row);
      registerDisposer(() => { row.disposed++; });
      createEffect(() => { tick(); row.reads++; });
      row.node = h('li', null, () => `${index()}:${item.label}:${tick()}`);
      return row.node;
    }, { updateOnItemChange: rerender ? 'rerender' : 'none' }));
  });
  return { container, rows, stop, writeItems, pulse: () => writeTick(++turn) };
}

function expectLiveRowsOnly(f: ReturnType<typeof owned>) {
  const active = new Set(Array.from(f.container.children));
  const reads = f.rows.map(row => row.reads);
  f.pulse();
  f.rows.forEach((row, index) => {
    expect(row.reads, `effect for ${row.label}`).toBe(reads[index]! + (active.has(row.node) ? 1 : 0));
    expect(row.disposed, `owner for ${row.label}`).toBe(active.has(row.node) ? 0 : 1);
  });
}

function expectAllStopped(f: ReturnType<typeof owned>) {
  f.stop();
  const reads = f.rows.map(row => row.reads);
  f.pulse();
  expect(f.rows.map(row => row.reads)).toEqual(reads);
  expect(f.rows.map(row => row.disposed)).toEqual(f.rows.map(() => 1));
}

describe('SameValueZero keys and per-occurrence row ownership', () => {
  it.each(sizes)('low-level matching retains NaN and signed-zero occurrences at n=%i', size => {
    const parent = document.createElement('ul'), original = items(size, true);
    const create = vi.fn((item: Item) => h('li', null, item.label));
    let state = reconcileList(parent, [], original, [], item => item.key, create, () => {});
    const nodes = [...state.nodes], insert = vi.spyOn(parent, 'insertBefore'), append = vi.spyOn(parent, 'appendChild');
    for (let round = 0; round < 3; round++) {
      const next = original.map(item => ({ ...item, key: item.key === 0 ? +0 : item.key }));
      state = reconcileList(parent, state.items, next, state.nodes, item => item.key, create, () => {});
      state.nodes.forEach((node, index) => expect(node).toBe(nodes[index]));
    }
    expect(create).toHaveBeenCalledTimes(size);
    expect(insert).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
  });

  it.each(sizes)('retains NaN identity and stops removed and root-owned effects at n=%i', size => {
    const original = items(size), f = owned(original), nodes = Array.from(f.container.children);
    const insert = vi.spyOn(f.container, 'insertBefore');
    for (let round = 0; round < 3; round++) {
      f.writeItems(original.map(item => ({ ...item, key: item.key === 0 ? +0 : item.key })));
      Array.from(f.container.children).forEach((node, index) => expect(node).toBe(nodes[index]));
      expectLiveRowsOnly(f);
    }
    expect(insert).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(size);
    f.writeItems(original.slice(1));
    expect(f.container.firstElementChild).toBe(nodes[1]);
    expectLiveRowsOnly(f);
    expect(f.rows[0]!.disposed).toBe(1);
    expectAllStopped(f);
  });

  it.each(sizes)('owns duplicate NaN, zero, string and finite-key occurrences separately at n=%i', size => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = items(size, true), f = owned(original), nodes = Array.from(f.container.children);
    f.writeItems(original.map(item => ({ ...item })));
    Array.from(f.container.children).forEach((node, index) => expect(node).toBe(nodes[index]));
    expectLiveRowsOnly(f);
    // Matching consumes the first occurrence of each duplicate, independently
    // of object identity. Only those first row nodes and owners remain.
    const next = original.filter((_, index) => index >= 8 || index % 2 === 0);
    f.writeItems(next);
    const retained = nodes.filter((_, index) => index >= 8 || index % 2 === 0);
    Array.from(f.container.children).forEach((node, index) => expect(node).toBe(retained[index]));
    expectLiveRowsOnly(f);
    Array.from(f.container.children).forEach((node, index) => expect(node.textContent).toMatch(new RegExp(`^${index}:`)));
    f.writeItems([]);
    expectLiveRowsOnly(f);
    expectAllStopped(f);
  });

  it.each(sizes)('rerenders each matched duplicate owner and disposes all prior generations at n=%i', size => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = items(size, true), f = owned(original, true);
    let previous = Array.from(f.container.children);
    for (let round = 1; round <= 3; round++) {
      const next = original.map(item => ({ ...item, label: `${item.label}-v${round}` }));
      f.writeItems(next);
      const current = Array.from(f.container.children);
      expect(current).toHaveLength(size);
      current.forEach((node, index) => {
        expect(node).not.toBe(previous[index]);
        expect(node.textContent).toContain(`${index}:${next[index]!.label}:`);
      });
      expectLiveRowsOnly(f);
      previous = current;
    }
    f.writeItems([]);
    expectLiveRowsOnly(f);
    expectAllStopped(f);
  });

  it.each(sizes)('rerenders only the changed NaN or signed-zero occurrence at n=%i', size => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let next = items(size, true);
    const f = owned(next, true);
    for (const changed of [1, 3]) {
      const before = Array.from(f.container.children);
      next = next.map((item, index) => index === changed ? { ...item, label: `${item.label}-changed` } : item);
      f.writeItems(next);
      Array.from(f.container.children).forEach((node, index) => {
        if (index === changed) expect(node).not.toBe(before[index]);
        else expect(node).toBe(before[index]);
        expect(node.textContent).toContain(`${index}:${next[index]!.label}:`);
      });
      expectLiveRowsOnly(f);
    }
    expectAllStopped(f);
  });

  it('retains the same occurrence owners across both directions of the threshold', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const all = items(64, true), f = owned(all.slice(0, 8));
    for (const size of [31, 32, 33, 64, 33, 32, 31, 8, 33, 8]) {
      const before = Array.from(f.container.children);
      f.writeItems(all.slice(0, size).map(item => ({ ...item })));
      const after = Array.from(f.container.children);
      expect(after).toHaveLength(size);
      for (let index = 0; index < Math.min(before.length, size); index++) expect(after[index]).toBe(before[index]);
      expectLiveRowsOnly(f);
      after.forEach((node, index) => expect(node.textContent).toMatch(new RegExp(`^${index}:`)));
    }
    expectAllStopped(f);
  });
});
