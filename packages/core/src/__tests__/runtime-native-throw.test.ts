import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * FORMA-271: one native that throws costs one binding, not the module.
 *
 * FORMA-268's review found that an allowlisted native that throws on its
 * arguments (`{JSON.parse('{')}`, `{(1).toFixed(500)}`, `{(1).toString(1)}`)
 * escaped `mountMarkup` from any binding, in happy-dom and in Chromium: the
 * error was not an expression error, so the binding boundary rethrew it, and
 * `mountMarkup` disposed everything it had bound and threw. One bad payload in
 * a `data-text`, which server data and generated UI make easily, took down the
 * whole module. A handler's threw as an uncaught page error, with no
 * diagnostic.
 *
 * Now the call is refused with `FORMA_E_CALL_FAILED` on the binding that made
 * it, reported like any expression that cannot be evaluated, and the rest of
 * the module binds and works. A real bug in Forma's own code is still not
 * filed as an expression failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('an allowlisted native that throws (FORMA-271)', () => {
  let container: HTMLDivElement;
  let errors: string[];

  beforeEach(async () => {
    await tick();
    runtime.clearDiagnostics();
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.map(String).join(' ')); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    unmountFixture(container);
    container.remove();
    await tick();
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
  });

  const el = (id: string): Element => container.querySelector(`#${id}`)!;
  const diagnostics = (): Array<[string | undefined, string, string]> =>
    runtime.getDiagnostics().map((d) => [d.code, d.expr, d.reason]);

  it.each([
    [`JSON.parse('{')`, 'JSON.parse() threw SyntaxError: '],
    ['JSON.parse(payload)', 'JSON.parse() threw SyntaxError: '],
    ['(1).toFixed(500)', 'number.toFixed() threw RangeError: '],
    ['(1).toString(1)', 'number.toString() threw RangeError: '],
    ['price.toPrecision(0)', 'number.toPrecision() threw RangeError: '],
    ['Object.keys(user).length', 'Object.keys() threw TypeError: '],
    ['Array.from(user)', 'Array.from() threw TypeError: '],
    ['empty.reduce((a, b) => a + b)', 'array.reduce() threw TypeError: '],
    ['items.map()', 'array.map() threw TypeError: '],
    [`$el.matches('#1')`, '$el.matches() threw '],
    [`$el.closest('#1')`, '$el.closest() threw '],
  ])('data-text="{%s}" is reported on its element and the rest of the module mounts', async (expr, reason) => {
    container.innerHTML = `<div data-forma-state='{"payload": "{\\"a\\":", "price": 2, "user": null, "empty": [], "items": [1], "n": 1}'>
      <p id="bad" data-text="{${expr}}">server text</p>
      <p id="good" data-text="{n + 1}">server</p>
    </div>`;
    expect(() => mountFixture(container)).not.toThrow();
    await tick();
    expect(diagnostics()).toHaveLength(1);
    const [code, reported, why] = diagnostics()[0]!;
    expect([code, reported]).toEqual(['FORMA_E_CALL_FAILED', expr]);
    expect(why.startsWith(reason), why).toBe(true);
    expect(el('bad').textContent).toBe('server text');
    expect(el('bad').getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(el('good').textContent).toBe('2');
    expect(errors.filter((e) => e.includes('FORMA_E_CALL_FAILED'))).toHaveLength(1);
  });

  it('one native that throws costs one binding: every directive reports on its own element and the rest of the module works', async () => {
    container.innerHTML = `<div data-forma-state='{"raw": "{\\"a\\":", "good": "{\\"a\\":1}", "count": 0, "x": 0}'>
      <p id="text" data-text="{JSON.parse(raw).a}">server text</p>
      <p id="show" data-show="{JSON.parse(raw).a}">shown</p>
      <i id="comp" data-computed="price = (1).toFixed(500)"></i>
      <p id="reader" data-text="{price}">reader</p>
      <ul id="list" data-list="{Object.keys(null)}"><li>{item}</li></ul>
      <a id="bind" data-bind:title="{(1).toString(1)}" title="kept">a</a>
      <b id="cls" data-class:on="{JSON.parse(raw)}">b</b>
      <button id="handler" data-on:click="{x = (255).toString(37)}">bad</button>
      <p id="ok" data-text="{JSON.parse(good).a + count}">ok</p>
      <p id="x" data-text="{x}">x</p>
      <button id="inc" data-on:click="{count++}">+</button>
    </div>`;
    expect(() => mountFixture(container)).not.toThrow();
    await tick();
    for (const id of ['text', 'show', 'reader', 'list', 'bind', 'cls']) {
      expect(el(id).getAttribute('data-forma-expr-error'), id).toBe('unsupported');
    }
    expect(el('text').textContent).toBe('server text');
    expect((el('show') as HTMLElement).style.display).toBe('');
    expect(el('reader').textContent).toBe('reader');
    expect(el('list').children).toHaveLength(0);
    expect(el('bind').getAttribute('title')).toBe('kept');
    expect(el('cls').classList.contains('on')).toBe(false);
    expect(el('ok').textContent).toBe('1');

    // The handler whose native throws reports on its element and leaves state
    // as it was; a working handler beside it still runs.
    expect(() => (el('handler') as HTMLElement).click()).not.toThrow();
    (el('inc') as HTMLElement).click();
    await tick();
    expect(el('handler').getAttribute('data-forma-handler-error')).toBe('unsupported');
    expect(el('ok').textContent).toBe('2');
    expect(el('x').textContent).toBe('0');
    (el('handler') as HTMLElement).click();
    expect(el('ok').textContent).toBe('2');

    const codes = runtime.getDiagnostics().map((d) => [d.kind, d.code, d.expr]);
    expect(codes).toEqual([
      ['expression-unsupported', 'FORMA_E_CALL_FAILED', 'JSON.parse(raw).a'],
      ['expression-unsupported', 'FORMA_E_CALL_FAILED', 'price'],
      ['expression-unsupported', 'FORMA_E_CALL_FAILED', 'Object.keys(null)'],
      ['expression-unsupported', 'FORMA_E_CALL_FAILED', '(1).toString(1)'],
      ['expression-unsupported', 'FORMA_E_CALL_FAILED', 'JSON.parse(raw)'],
      ['handler-unsupported', 'FORMA_E_CALL_FAILED', 'x = (255).toString(37)'],
    ]);
    expect(runtime.getDiagnostics().find((d) => d.expr === 'price')!.reason)
      .toBe('number.toFixed() threw RangeError: toFixed() digits argument must be between 0 and 100');
    expect(errors.some((e) => e.includes('Uncaught') || e.includes('binding error'))).toBe(false);
  });

  it('a real bug in code a native runs is rethrown, not filed as the native failing', async () => {
    // The counterpart of failure-semantics' "a genuine runtime bug is not
    // swallowed": the same bug, read inside a callback that `map` runs.
    const boom = new RangeError('a real bug');
    container.innerHTML = `<div data-forma-state='{"n":1,"m":0,"items":[1,2]}'>
      <p id="p" data-text="{items.map(i => i + n + m).join(',')}"></p>
    </div>`;
    mountFixture(container);
    await tick();
    expect(el('p').textContent).toBe('2,3');
    const root = container.firstElementChild!;
    const scope = (root as unknown as { __formaScope: { getters: Record<string, () => unknown> } }).__formaScope;
    const original = scope.getters.n!;
    scope.getters.n = () => { throw boom; };
    try {
      runtime.setScopeValue(root, 'm', 5);
      await tick();
    } finally {
      scope.getters.n = original;
    }
    expect(errors.some((e) => e.includes('RangeError') && e.includes('a real bug'))).toBe(true);
    expect(runtime.getDiagnostics()).toEqual([]);
    expect(el('p').hasAttribute('data-forma-expr-error')).toBe(false);
  });

  it("a native that throws is final: it arms nothing, and what it was charged before it ran stays on the task's meter", async () => {
    // As a refusal that checks a length or a count (FORMA-249, FORMA-250):
    // `JSON.parse(big)` is charged its argument's 200,000 units before it
    // runs and throws. Those units stay spent, so a 200,000-unit binding after
    // it in the task waits one tick; nothing is armed, so a 40,000-unit
    // binding, past the 10,000-unit cap a wait arms, fits the 50,000 units
    // left and renders now. `JSON.parse('{')` spends nothing, and neither
    // waits. Only the native is reported.
    const big = '{' + 'x'.repeat(199_999);
    const cases: [string, Record<number, number>][] = [
      [`JSON.parse('{')`, { 200_000: 0, 40_000: 0 }],
      ['JSON.parse(big)', { 200_000: 1, 40_000: 0 }],
    ];
    for (const [bad, late] of cases) {
      for (const [n, expected] of Object.entries(late)) {
        const units = Number(n);
        await tick();
        container.innerHTML = `<div data-forma-state='{"s":"","big":"${big}"}'>
          <p data-out data-text="{s.length === 0 ? 0 : ${bad}}">server</p>
          <p data-out data-text="{s.length === 0 ? 0 : Array.from({length: ${units - 10}}).length}">server</p>
        </div>`;
        mountFixture(container);
        runtime.clearDiagnostics();
        runtime.setScopeValue(container.firstElementChild!, 's', 'x');
        const texts = (): string[] => [...container.querySelectorAll('[data-out]')].map((e) => e.textContent ?? '');
        let ticks = 0;
        while (texts()[1] !== String(units - 10) && ticks < 10) {
          await tick();
          ticks++;
        }
        expect(ticks, `${bad} then ${units} units: ticks after the update before the binding renders`).toBe(expected);
        expect(texts()[0], `${bad}: refused, its previous text kept`).toBe('0');
        for (let i = 0; i < 3; i++) await tick();
        expect(runtime.getDiagnostics().map((d) => [d.code, d.count]), `${bad} then ${units} units`).toEqual([['FORMA_E_CALL_FAILED', 1]]);
        unmountFixture(container);
        runtime.clearDiagnostics();
      }
    }
  });
});
