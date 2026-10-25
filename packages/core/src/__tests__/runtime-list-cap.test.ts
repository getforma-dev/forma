import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * FORMA-172: an absolute cap on a `data-list` pass.
 *
 * A list built a row of DOM for every item, however cheap the expression that
 * produced them: `Array.from({length: 249990})` was 249,990 template clones in
 * one task, 3.3 s at 4x CPU throttling. A pass is now refused when its rows
 * times the weight of a row (1, and 1 for each element and attribute of the
 * row template, a nested `<template>`'s contents included) pass
 * `LIST_WEIGHT_CAP` = 24,000, before any item is read or any row is built.
 * Under the cap nothing changes: no per-task charge, no waiting, the rows
 * render in the task that hands the list its items, as on main.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const CAP = 24_000;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function settle(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i++) await tick();
}

/** An expression that spends `units` of the 250,000-unit allocation budget and answers `units - 10`. */
const spending = (units: number): string => `Array.from({length: ${units - 10}}).length`;

/** A row of one `<li>` with `n` plain attributes: weight n + 2. */
const attrs = (n: number, inner = '{item}'): string => `<li ${Array.from({ length: n }, (_, i) => `a${i}="v"`).join(' ')}>${inner}</li>`;

/** The runtime's weight of a row template, computed the same way, for the tests to state their numbers. */
function weightOf(row: string): number {
  const host = document.createElement('ul');
  host.innerHTML = row;
  const template = host.firstElementChild!;
  let weight = 1;
  const held: ParentNode[] = [template];
  for (const root of held) {
    for (const node of [root, ...root.querySelectorAll('*')] as Element[]) {
      weight += 1 + (node.attributes?.length ?? 0);
      if (node.localName === 'template') held.push((node as HTMLTemplateElement).content);
    }
  }
  return weight;
}

const items = (n: number): number[] => Array.from({ length: n }, (_, i) => i % 10);

describe('a data-list pass past an absolute cap is refused (FORMA-172)', () => {
  let container: HTMLDivElement;
  const rows = (selector = 'li'): number => container.querySelectorAll(selector).length;
  const codes = (): string[] => runtime.getDiagnostics().map((d) => d.code ?? '');
  const budget = (): unknown[] => runtime.getDiagnostics().filter((d) => d.code === 'FORMA_E_BUDGET');
  const scope = (): Element => container.querySelector('[data-forma-state]')!;

  /** Mount a list over `list` (an expression), with `state`, a row template and markup before or after it. */
  async function mount(state: unknown, list: string, row = '<li>{item}</li>', before = '', after = '', tag = 'ul'): Promise<void> {
    unmountFixture(container);
    await tick();
    runtime.clearDiagnostics();
    container.innerHTML = `<div data-forma-state='${JSON.stringify(state)}'>${before}<${tag} data-out data-list="${list}">${row}</${tag}>${after}</div>`;
    mountFixture(container);
  }

  beforeEach(async () => {
    await tick();
    runtime.clearDiagnostics();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    unmountFixture(container);
    container.remove();
    await settle(2);
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('a list of 250,000 items is refused before any item is read', async () => {
    // `<li>{item}</li>` weighs 2: 250,000 rows are 500,000, over the cap. A
    // proxy counts the reads of the items: none, and no row is built. A read
    // also throws, so a missing cap fails here at its first item rather than
    // building 250,000 rows for the teardown to remove.
    const reads = { n: 0 };
    const list = new Proxy(items(250_000), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          reads.n++;
          throw new Error('an item was read past the cap');
        }
        return Reflect.get(target, key, receiver);
      },
    });
    await mount({ rows: [] }, '{rows}');
    runtime.setScopeValue(scope(), 'rows', list);
    expect(rows()).toBe(0);
    expect(reads.n).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });

  it('a list of Array.from({length: 249990}) builds no row', async () => {
    await mount({}, '{Array.from({length: 249990})}');
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    expect(runtime.getDiagnostics()[0]!.expr).toBe('Array.from({length: 249990})');
  });

  it('a list exactly at the cap renders, and one row more is refused', async () => {
    // A row of `<li>` with 22 attributes weighs 24: 1,000 rows are the cap.
    const row = attrs(22);
    expect(weightOf(row)).toBe(24);
    await mount({ rows: items(1000) }, '{rows}', row);
    expect(rows()).toBe(1000);
    expect(codes()).toEqual([]);
    await mount({ rows: items(1001) }, '{rows}', row);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    // The lightest row there is, `<li>{item}</li>`, weighs 2: 12,000 rows.
    expect(CAP / weightOf('<li>{item}</li>')).toBe(12_000);
  });

  it('a refused list is reported once, naming the data-list and its row limit, and keeps the rows it had', async () => {
    await mount({ rows: items(1000) }, '{rows}');
    expect(rows()).toBe(1000);
    await tick();
    runtime.setScopeValue(scope(), 'rows', items(90_000));
    expect(rows()).toBe(1000);
    expect(container.querySelector('li')!.textContent).toBe('0');
    const [d, ...more] = runtime.getDiagnostics();
    expect(more).toEqual([]);
    expect(d).toMatchObject({ kind: 'expression-unsupported', code: 'FORMA_E_BUDGET', expr: 'rows', count: 1 });
    expect(d!.reason).toBe('a data-list of rows weighing 2 is refused past 12000 rows (rows × weight is capped at 24000)');
    expect(container.querySelector('ul')!.getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/not evaluated: rows\n.*FORMA_E_BUDGET: a data-list of rows weighing 2.*\n.*on: <ul [^>]*data-list="\{rows\}"/));
    // Final: no later task builds them.
    await settle();
    expect(rows()).toBe(1000);
    expect(budget()).toHaveLength(1);
    // A list under the cap renders again.
    runtime.setScopeValue(scope(), 'rows', items(5));
    expect(rows()).toBe(5);
  });

  it('a page of a long list renders: the remedy the docs give for a refused list', async () => {
    // `rows.slice(0, 200)` over 240,000 items is charged the 240,000 it reads
    // (and its two arguments), within the 250,000-unit allocation budget, and
    // renders its 200 rows; unsliced, the list is refused. A slice of 250,000
    // items is over that budget by its arguments' weight.
    await mount({ rows: items(240_000) }, '{rows.slice(0, 200)}');
    expect(rows()).toBe(200);
    expect(codes()).toEqual([]);
    await mount({ rows: items(240_000) }, '{rows}');
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });

  it('a directive row at the cap retains its rows when one more is refused', async () => {
    const row = '<li data-key="{item.id}"><b data-text="{item.name}"></b></li>';
    expect(weightOf(row)).toBe(5);
    const most = CAP / 5;
    const data = (n: number) => Array.from({ length: n }, (_, id) => ({ id, name: `Row ${id}` }));
    await mount({ rows: [] }, '{rows}', row);
    runtime.setScopeValue(scope(), 'rows', data(most));
    expect(rows()).toBe(most);
    expect(codes()).toEqual([]);
    runtime.setScopeValue(scope(), 'rows', data(most + 1));
    expect(rows()).toBe(most);
    expect(runtime.getDiagnostics()[0]!.reason).toBe('a data-list of rows weighing 5 is refused past 4800 rows (rows × weight is capped at 24000)');
  }, 30_000);

  it('a 1,000-row table with directives in every row, and an ordinary list, render as before', async () => {
    const row = '<tr data-key="{item.id}"><td>{item.id}</td><td data-text="{item.a}"></td><td data-text="{item.b}"></td><td data-class:odd="{item.c > 3}">{item.c}</td><td data-show="{item.d}">yes</td><td><b>{item.a}</b></td></tr>';
    const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, a: `a${i}`, b: `b${i}`, c: i % 7, d: i % 2 === 0 }));
    unmountFixture(container);
    container.innerHTML = `<div data-forma-state='${JSON.stringify({ rows: data })}'><table><tbody data-list="{rows}">${row}</tbody></table></div>`;
    mountFixture(container);
    expect(rows('tr')).toBe(1000);
    expect(container.querySelectorAll('tr')[999]!.children[1]!.textContent).toBe('a999');
    expect(codes()).toEqual([]);

    await mount({ rows: items(10_000) }, '{rows}');
    expect(rows()).toBe(10_000);
    expect(codes()).toEqual([]);
  }, 30_000);

  it('the contents of a <template> in a row count toward its weight', async () => {
    // The row's 1, then <li>, <template>, the template's fragment and the 497
    // <span>s in it, 1 each: weight 501; 47 rows fit.
    const row = `<li><template>${'<span></span>'.repeat(497)}</template></li>`;
    const w = weightOf(row);
    expect(w).toBe(501);
    const most = Math.floor(CAP / w);
    expect(most).toBe(47);
    await mount({ rows: items(most) }, '{rows}', row);
    expect(rows()).toBe(most);
    expect(codes()).toEqual([]);
    await mount({ rows: items(most + 1) }, '{rows}', row);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  }, 30_000);

  it('each list inside the rows of another is checked on its own', async () => {
    // Ten groups, each a list of `n` rows; the fourth has 90,000 (180,000, over
    // the cap) and is refused alone, the other nine render their 100 rows.
    const groups = Array.from({ length: 10 }, (_, g) => ({ n: g === 3 ? 90_000 : 100 }));
    unmountFixture(container);
    container.innerHTML = `<div data-forma-state='${JSON.stringify({ groups })}'>`
      + '<section data-list="{groups}"><div><ul data-list="{Array.from({length: item.n})}"><li>-</li></ul></div></section></div>';
    mountFixture(container);
    const counts = [...container.querySelectorAll('section ul')].map((u) => u.children.length);
    expect(counts).toEqual([100, 100, 100, 0, 100, 100, 100, 100, 100, 100]);
    expect(budget()).toHaveLength(1);
  }, 30_000);

  it('a list under the cap charges the task nothing: the bindings in its rows and after it render in the same task', async () => {
    // 1,000 rows of weight 24, each with six cells that charge (a method
    // call), are the cap exactly. Every cell binds in the mount task, and a
    // binding after the list that spends 200,000 of the task's 250,000 units
    // renders there too: the list took nothing from the task's budget.
    const cells = '<span data-text="{item.toUpperCase()}"></span>'.repeat(6);
    const row = attrs(10, cells);
    expect(weightOf(row)).toBe(24);
    const name = 'x'.repeat(40);
    await mount({ rows: Array.from({ length: 1000 }, () => name) }, '{rows}', row, '', `<p data-text="{${spending(200_000)}}">server</p>`);
    expect(rows()).toBe(1000);
    const bound = [...container.querySelectorAll('li span')].filter((c) => c.textContent === name.toUpperCase()).length;
    expect(bound).toBe(6000);
    expect(container.querySelector('p')!.textContent).toBe('199990');
    expect(codes()).toEqual([]);
  }, 30_000);

  it('a refused list delays no binding and no list after it', async () => {
    // The refusal checks a length and weighs nothing, so it arms no cap
    // (FORMA-249): a binding of 200,000 units and a list of 1,000 rows after it
    // render in the same task.
    await mount(
      { big: items(90_000), small: items(1000) },
      '{big}',
      '<li>{item}</li>',
      '',
      `<p data-text="{${spending(200_000)}}">server</p><ol data-list="{small}"><li>{item}</li></ol>`,
    );
    expect(container.querySelectorAll('ul li')).toHaveLength(0);
    expect(container.querySelector('p')!.textContent).toBe('199990');
    expect(container.querySelectorAll('ol li')).toHaveLength(1000);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });
});
