import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * FORMA-172: an absolute cap on a `data-list` pass.
 *
 * A list built a row of DOM for every item, however cheap the expression that
 * produced them: `Array.from({length: 249990})` was 249,990 template clones in
 * one task, 3.3 s at 4x CPU throttling. A pass is now refused when its rows
 * times the weight of a row (1, and 1 for each element and attribute of the
 * row template, a nested `<template>`'s contents included) pass
 * `LIST_WEIGHT_CAP` = 160,000, before any item is read or any row is built.
 * Under the cap nothing changes: no per-task charge, no waiting, the rows
 * render in the task that hands the list its items, as on main.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const CAP = 160_000;
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

/** vector-studio's todo-list and team-roster rows as the app serves them (data-fm stamped): see the fixtures' headers. */
const fixture = (name: string): string => readFileSync(resolve(process.cwd(), `e2e/fixtures/${name}`), 'utf8').replace(/<!--[\s\S]*?-->/, '').trim();
const TODO_ROW = fixture('vector-studio-todo-row.html');
const ROSTER_ROW = fixture('vector-studio-roster-row.html');
const todos = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({
  id: i, title: `Task ${i}`, done: i % 3 === 0, priority: ['high', 'medium', 'low'][i % 3], due: i % 2 ? '2025-07-10' : '',
}));
const people = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({
  id: i, name: `Person ${i}`, initials: `P${i % 10}`, role: 'Engineer', dept: 'Platform', email: `p${i}@example.com`,
  phone: '555-0100', bio: 'Builds things.', linkedin: '#', twitter: '#',
}));

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
    // proxy counts the reads of the items: none, and no row is built.
    const reads = { n: 0 };
    const list = new Proxy(items(250_000), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads.n++;
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
    // A row of `<li>` with 158 attributes weighs 160: 1,000 rows are the cap.
    const row = attrs(158);
    expect(weightOf(row)).toBe(160);
    await mount({ rows: items(1000) }, '{rows}', row);
    expect(rows()).toBe(1000);
    expect(codes()).toEqual([]);
    await mount({ rows: items(1001) }, '{rows}', row);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    // The lightest row there is, `<li>{item}</li>`, weighs 2: 80,000 rows.
    expect(CAP / weightOf('<li>{item}</li>')).toBe(80_000);
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
    expect(d!.reason).toBe('a data-list of rows weighing 2 is refused past 80000 rows (rows × weight is capped at 160000)');
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

  it('1,000 rows of each of the heaviest row templates vector-studio serves render, in the task that hands the list its items', async () => {
    // The todo-list row weighs 144 (21 elements, 122 attributes), the
    // team-roster row 150 (27 elements, 122 attributes): 1,000 rows of either
    // are under the cap (144,000 and 150,000).
    expect(weightOf(TODO_ROW)).toBe(144);
    expect(weightOf(ROSTER_ROW)).toBe(150);
    await mount({ rows: [], tasks: [], editingId: null, editingText: '' }, '{rows}', TODO_ROW, '', '', 'div');
    runtime.setScopeValue(scope(), 'rows', todos(1000));
    expect(rows('article')).toBe(1000);
    expect(container.querySelectorAll('[data-text="item.title"]')[999]!.textContent).toBe('Task 999');
    // The only diagnostics are the three handlers the 3.0 grammar refuses, none of them a budget.
    expect(budget()).toEqual([]);
    expect(new Set(runtime.getDiagnostics().map((d) => d.kind))).toEqual(new Set(['handler-unsupported']));

    await mount({ rows: [] }, '{rows}', ROSTER_ROW, '', '', 'div');
    runtime.setScopeValue(scope(), 'rows', people(1000));
    expect(rows('article')).toBe(1000);
    expect(codes()).toEqual([]);
  }, 120_000);

  it('the heaviest served row template renders up to the cap and is refused one row past it', async () => {
    // 160,000 / 150 = 1,066 team-roster rows (159,900); 1,067 are 160,050.
    expect(Math.floor(CAP / weightOf(ROSTER_ROW))).toBe(1066);
    await mount({ rows: [] }, '{rows}', ROSTER_ROW, '', '', 'div');
    runtime.setScopeValue(scope(), 'rows', people(1066));
    expect(rows('article')).toBe(1066);
    expect(codes()).toEqual([]);
    runtime.setScopeValue(scope(), 'rows', people(1067));
    expect(rows('article')).toBe(1066);
    expect(runtime.getDiagnostics()[0]!.reason).toBe('a data-list of rows weighing 150 is refused past 1066 rows (rows × weight is capped at 160000)');
  }, 120_000);

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
    // <span>s in it, 1 each: weight 501; 319 rows fit.
    const row = `<li><template>${'<span></span>'.repeat(497)}</template></li>`;
    const w = weightOf(row);
    expect(w).toBe(501);
    const most = Math.floor(CAP / w);
    expect(most).toBe(319);
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
    // 1,000 rows of weight 160, each with six cells that charge (a method
    // call), are the cap exactly. Every cell binds in the mount task, and a
    // binding after the list that spends 200,000 of the task's 250,000 units
    // renders there too: the list took nothing from the task's budget.
    const cells = '<span data-text="{item.toUpperCase()}"></span>'.repeat(6);
    const row = attrs(146, cells);
    expect(weightOf(row)).toBe(160);
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
