import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * FORMA-172: a `data-list` row is priced against the task's budget.
 *
 * FORMA-028 gave a task one allocation budget (250,000 units) and priced what
 * an expression or a conversion builds in it, but a `data-list` built a row of
 * DOM for every item whatever the list cost to produce: one cheap expression
 * (`Array.from({length: 249990})`) was 250,000 template clones, about 3.5 s in
 * one task at 4x CPU throttling. A row now costs 50 units for itself and for
 * each element and attribute of its template, charged with the list's
 * evaluation, so a list is refused, or waits for a task of its own, exactly as
 * a binding of that weight is. Every pass of a list rebinds all its rows, so
 * every pass is charged.
 *
 * These tests count the rows the runtime creates (template clones) per task:
 * `rowsMade()` is the number of outermost `cloneNode` calls since it was last
 * read, one for each row (the template itself is cloned once, when the list is
 * set up).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function settle(ticks = 40): Promise<void> {
  for (let i = 0; i < ticks; i++) await tick();
}

/** An expression that spends `units` of the 250,000-unit allocation budget and answers `units - 10`. */
const spending = (units: number): string => `Array.from({length: ${units - 10}}).length`;

/** The prototype that owns `cloneNode`, whatever the DOM implementation calls it. */
function cloner(): { cloneNode: (deep?: boolean) => Node } {
  let proto: object | null = Object.getPrototypeOf(document.createElement('li'));
  while (proto && !Object.hasOwn(proto, 'cloneNode')) proto = Object.getPrototypeOf(proto);
  return proto as { cloneNode: (deep?: boolean) => Node };
}

const LI = '<li>{item}</li>';
const items = (n: number): number[] => Array.from({ length: n }, (_, i) => i % 10);
const widget = (state: unknown, list: string, row = LI, extra = ''): string =>
  `<div data-forma-state='${JSON.stringify(state)}'>${extra}<ul data-out data-list="${list}">${row}</ul></div>`;

describe('a data-list row is priced against the task budget (FORMA-172)', () => {
  let container: HTMLDivElement;
  let cloned = 0;

  /** Rows created since the last call: template clones, less the one each list makes of its template when it is set up. */
  const rowsMade = (lists = 0): number => { const n = cloned - lists; cloned = 0; return n; };
  const rows = (): number => container.querySelectorAll('li').length;
  const codes = (): string[] => runtime.getDiagnostics().map((d) => d.code ?? '');

  beforeEach(async () => {
    await tick();
    runtime.clearDiagnostics();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cloned = 0;
    const owner = cloner();
    const real = owner.cloneNode;
    // A deep clone clones each descendant through the same method: count the outermost.
    let depth = 0;
    vi.spyOn(owner, 'cloneNode').mockImplementation(function (this: Node, deep?: boolean) {
      if (depth++ === 0) cloned++;
      try { return real.call(this, deep); } finally { depth--; }
    });
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

  it('a list of 1,000 rows renders in the mount task, as before', async () => {
    container.innerHTML = widget({ rows: items(1000) }, '{rows}');
    mountFixture(container);
    expect(rows()).toBe(1000);
    expect(rowsMade(1)).toBe(1000);
    expect(container.querySelector('li')!.textContent).toBe('0');
    expect(container.querySelectorAll('li')[999]!.textContent).toBe('9');
    await settle(3);
    expect(rows()).toBe(1000);
    expect(codes()).toEqual([]);
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
  });

  it('a list that would build 20,000 rows in one task builds none, and is reported once, naming the list', async () => {
    const state = { rows: items(20_000) };
    container.innerHTML = widget(state, '{rows}');
    mountFixture(container);
    expect(rowsMade(1)).toBe(0);
    expect(rows()).toBe(0);
    // Reported at once, as a binding over the whole budget is, with the budget's code.
    const [d, ...more] = runtime.getDiagnostics();
    expect(more).toEqual([]);
    expect(d).toMatchObject({ kind: 'expression-unsupported', code: 'FORMA_E_BUDGET', expr: 'rows', count: 1 });
    expect(d!.reason).toContain('data-list');
    expect(container.querySelector('ul')!.getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(d!.reason).toBe('building the rows of a data-list would exceed the 250000-unit allocation budget');
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/not evaluated: rows\n.*FORMA_E_BUDGET: building the rows of a data-list.*\n.*on: <ul [^>]*data-list="\{rows\}"/));
    // Final, not retried: no later task builds them.
    await settle(5);
    expect(rowsMade()).toBe(0);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  }, 30_000);

  it('a list of 249,990 items made by one cheap expression builds no row', async () => {
    container.innerHTML = widget({}, '{Array.from({length: 249990})}');
    mountFixture(container);
    expect(rowsMade(1)).toBe(0);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    expect(runtime.getDiagnostics()[0]!.expr).toBe('Array.from({length: 249990})');
    await settle(3);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  }, 120_000);

  it('a list of 250,000 numbers from state is refused before its items are read', async () => {
    // The refusal is O(1) in the length: a proxy counts the reads of the items.
    const reads = { n: 0 };
    const list = new Proxy(items(250_000), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads.n++;
        return Reflect.get(target, key, receiver);
      },
    });
    container.innerHTML = widget({ rows: [] }, '{rows}');
    mountFixture(container);
    runtime.setScopeValue(container.querySelector('[data-forma-state]')!, 'rows', list);
    expect(rows()).toBe(0);
    expect(reads.n).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });

  it('the largest list one task holds is the budget over the price of its row', async () => {
    // `<li>{item}</li>` weighs 2: the row, and its one element (no attributes).
    // 2 x 50 = 100 units a row; 250,000 / 100 = 2,500 rows.
    container.innerHTML = widget({ rows: items(2500) }, '{rows}');
    mountFixture(container);
    expect(rows()).toBe(2500);
    expect(codes()).toEqual([]);

    unmountFixture(container);
    await tick();
    runtime.clearDiagnostics();
    container.innerHTML = widget({ rows: items(2501) }, '{rows}');
    mountFixture(container);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });

  it('the price of a row follows its template: elements and attributes', async () => {
    // <li><span>{item}</span><span class="n" id="x">{item}</span></li>: the row,
    // three elements and two attributes weigh 6, 300 units a row, 833 rows.
    const row = '<li><span>{item}</span><span class="n" id="x">{item}</span></li>';
    container.innerHTML = widget({ rows: items(833) }, '{rows}', row);
    mountFixture(container);
    expect(rows()).toBe(833);
    expect(codes()).toEqual([]);

    unmountFixture(container);
    await tick();
    runtime.clearDiagnostics();
    container.innerHTML = widget({ rows: items(834) }, '{rows}', row);
    mountFixture(container);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });

  it('the price of a row counts what a template in it holds', async () => {
    // A <template> is cloned with its contents: the row, <li>, <template> and
    // its fragment weigh 4 and the thousand <span>s in it 1,000: 1,004, 50,200
    // units a row, 4 rows (200,800) and not 5 (251,000).
    const row = `<li><template>${'<span></span>'.repeat(1000)}</template></li>`;
    container.innerHTML = widget({ rows: items(4) }, '{rows}', row);
    mountFixture(container);
    expect(rows()).toBe(4);
    expect(codes()).toEqual([]);

    unmountFixture(container);
    await tick();
    runtime.clearDiagnostics();
    container.innerHTML = widget({ rows: items(5) }, '{rows}', row);
    mountFixture(container);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });

  it('a list that fits a task of its own but not what is left of this one waits, unreported, and renders in the next', async () => {
    // 200,000 units are spent first; 1,000 rows are 100,000.
    container.innerHTML = widget({ rows: items(1000) }, '{rows}', LI, `<p data-out data-text="{${spending(200_000)}}">server</p>`);
    mountFixture(container);
    expect(container.querySelector('p')!.textContent).toBe('199990');
    expect(rows()).toBe(0);
    expect(rowsMade(1)).toBe(0);
    await settle(3);
    expect(rows()).toBe(1000);
    expect(rowsMade()).toBe(1000);
    expect(codes()).toEqual([]);
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
  });

  it('every pass of a list is priced: a second pass in the same task waits for the next', async () => {
    // 2,000 rows are 200,000 units. A pass rebinds every row, so two passes in
    // one task are 400,000: the second waits, and the rows keep the first's text.
    container.innerHTML = widget({ rows: items(2000) }, '{rows}');
    mountFixture(container);
    expect(rows()).toBe(2000);
    const scope = container.querySelector('[data-forma-state]')!;
    runtime.setScopeValue(scope, 'rows', items(2000).map((n) => n + 100));
    expect(container.querySelector('li')!.textContent).toBe('0');
    await settle(3);
    expect(container.querySelector('li')!.textContent).toBe('100');
    expect(rows()).toBe(2000);
    expect(codes()).toEqual([]);
  });

  it('a page of a long list renders: the remedy the docs give for a list that is refused', async () => {
    // `rows.slice(0, 200)` over 100,000 items: the slice is charged by the
    // length of the array it reads (cost.ts, `array.slice`), 100,000 units, and
    // its 200 rows by 20,000. The same list unsliced is refused.
    container.innerHTML = widget({ rows: items(100_000) }, '{rows.slice(0, 200)}');
    mountFixture(container);
    expect(rows()).toBe(200);
    expect(codes()).toEqual([]);
    unmountFixture(container);
    await tick();
    container.innerHTML = widget({ rows: items(100_000) }, '{rows}');
    mountFixture(container);
    expect(rows()).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  });

  it('a list refused after rows were drawn leaves them as they were', async () => {
    container.innerHTML = widget({ rows: items(1000) }, '{rows}');
    mountFixture(container);
    expect(rows()).toBe(1000);
    await tick();
    runtime.setScopeValue(container.querySelector('[data-forma-state]')!, 'rows', items(20_000));
    expect(rows()).toBe(1000);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    await settle(3);
    expect(rows()).toBe(1000);
  }, 30_000);

  it('the lists inside the rows of a list spend the same budget: ten lists of 600 rows render over several tasks, none reported', async () => {
    // Each inner list is 600 rows of weight 2: 60,000 units. The outer pass is
    // 10 rows and what it places of each (about 26,500 units), so the mount task
    // holds three inner lists (180,000 + 26,500); the next, which has no outer
    // pass in it, holds four (240,000), and the last three wait for a third.
    const groups = Array.from({ length: 10 }, () => ({ rows: items(600) }));
    container.innerHTML = `<div data-forma-state='${JSON.stringify({ groups })}'>`
      + '<section data-list="{groups}"><div><ul data-list="{item.rows}"><li>x</li></ul></div></section></div>';
    mountFixture(container);
    expect(rows()).toBe(1800);
    await tick();
    expect(rows()).toBe(4200);
    await settle();
    expect(rows()).toBe(6000);
    expect(codes()).toEqual([]);
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
  }, 30_000);

  it('a refused list arms the task\'s cap as a refused binding does: a list past the cap waits a task, a light binding renders now', async () => {
    // The first list is refused for good and arms the cap (10,000 units a
    // charge for the rest of the task). The second, 150 rows (15,000 units), is
    // past the cap and waits; the binding after it (about 1,150 units) fits.
    container.innerHTML = `<div data-forma-state='${JSON.stringify({ big: items(20_000), small: items(150), label: 'ok' })}'>`
      + '<ul data-list="{big}"><li>{item}</li></ul>'
      + '<ol data-list="{small}"><li>{item}</li></ol>'
      + '<p data-out data-text="{label.toUpperCase()}">server</p></div>';
    mountFixture(container);
    expect(container.querySelectorAll('ul li')).toHaveLength(0);
    expect(container.querySelectorAll('ol li')).toHaveLength(0);
    expect(container.querySelector('p')!.textContent).toBe('OK');
    await settle(3);
    expect(container.querySelectorAll('ol li')).toHaveLength(150);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
  }, 30_000);
});
