import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * FORMA-268: a `data-computed` that reads its own value, and one named like a
 * state key.
 *
 * forma-vector-studio's generated `retro-homepage` declares
 * `data-computed="visitCount = visitCount"` over a `visitCount` state key. The
 * interpreter resolves a name when it is read, not when the expression is
 * compiled, so the computed read its own getter while it was being evaluated;
 * alien-signals answers that re-entrant read with the computed's current value,
 * `undefined` before its first evaluation, and `mountMarkup` threw
 * `TypeError: Cannot read properties of undefined (reading 'ok')` out of the
 * first binding that read the name. Nothing after it was bound.
 *
 * Now a computed whose expression reads its own name is refused on its element
 * at bind time and binds nothing, so the name keeps what it had. At run time a
 * read of a computed while it is being evaluated (through another computed, or
 * a handler a `$dispatch` in it runs) is refused on its element, and the reader
 * reports it. Every case is a coded diagnostic, and the rest of the module
 * binds. The limits of both checks are pinned here as well.
 *
 * A computed may still be named like a state key, and the readers bound after
 * it read the computed (docs/HTML-RUNTIME.md). Refusing that would break real
 * modules: of the 179 computeds found in the local app corpora on 2026-10-23,
 * 53 are named like a state key and 51 of them do not read themselves
 * (CHANGELOG, FORMA-268).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('a data-computed that reads itself, or shadows a state key (FORMA-268)', () => {
  let container: HTMLDivElement;
  let errors: string[];

  beforeEach(() => {
    runtime.clearDiagnostics();
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.map(String).join(' ')); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmountFixture(container);
    container.remove();
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
  });

  const text = (id: string): string | null => container.querySelector(`#${id}`)!.textContent;
  const marked = (id: string): string | null => container.querySelector(`#${id}`)!.getAttribute('data-forma-expr-error');
  const diagnostics = (): Array<[string, string, string]> =>
    runtime.getDiagnostics().map((d) => [d.code, d.expr, d.reason]);

  it('a computed that reads its own name is refused on its element, and the state key of that name keeps rendering', async () => {
    // retro-homepage's shape: the computed's name is a state key and its whole
    // expression is that name.
    container.innerHTML = `<div data-forma-state='{"n": 5, "other": 1}'>
      <i id="computed" data-computed="n = n"></i>
      <p id="reader" data-text="{n}">ssr</p>
      <p id="sibling" data-text="{other + 1}">ssr</p>
      <button id="inc" data-on:click="{n++}">+</button>
    </div>`;
    expect(() => mountFixture(container)).not.toThrow();
    await tick();
    expect(diagnostics()).toEqual([['FORMA_E_UNSUPPORTED', 'n = n', 'computed "n" reads its own name']]);
    expect(marked('computed')).toBe('unsupported');
    // The refused computed bound nothing: `n` is still the state key.
    expect(text('reader')).toBe('5');
    expect(marked('reader')).toBeNull();
    expect(text('sibling')).toBe('2');
    (container.querySelector('#inc') as HTMLElement).click();
    await tick();
    expect(text('reader')).toBe('6');
    expect(errors.some((e) => e.includes('TypeError'))).toBe(false);
  });

  it('a computed that reads its own name and is no state key is refused, and each reader reports the name unresolved', async () => {
    container.innerHTML = `<div data-forma-state='{"other": 1}'>
      <i id="computed" data-computed="x = x + 1"></i>
      <p id="reader" data-text="{x}">ssr</p>
      <p id="sibling" data-text="{other + 1}">ssr</p>
    </div>`;
    expect(() => mountFixture(container)).not.toThrow();
    await tick();
    expect(diagnostics()).toEqual([
      ['FORMA_E_UNSUPPORTED', 'x = x + 1', 'computed "x" reads its own name'],
      ['FORMA_E_UNRESOLVED', 'x', '"x" is not declared in this scope — expressions cannot reach globals'],
    ]);
    expect(marked('computed')).toBe('unsupported');
    expect(text('reader')).toBe('ssr');
    expect(marked('reader')).toBe('unsupported');
    expect(text('sibling')).toBe('2');
  });

  it('a computed reads its own value only as a free name: an arrow parameter, a property or a string of that name is not a self-reference', async () => {
    container.innerHTML = `<div data-forma-state='{"items": [1, 2], "o": {"n": "p"}}'>
      <i data-computed="n = items.map(n => n * 2).join(',') + ' n ' + o.n + {n: '!'}.n"></i>
      <p id="reader" data-text="{n}">ssr</p>
    </div>`;
    mountFixture(container);
    await tick();
    expect(diagnostics()).toEqual([]);
    expect(text('reader')).toBe('2,4 n p!');
  });

  it('a self-reference inside an arrow that does not bind the name is refused', async () => {
    container.innerHTML = `<div data-forma-state='{"items": [1, 2], "n": 5}'>
      <i id="computed" data-computed="n = items.map(x => x + n)"></i>
      <p id="reader" data-text="{n}">ssr</p>
    </div>`;
    mountFixture(container);
    await tick();
    expect(diagnostics()).toEqual([['FORMA_E_UNSUPPORTED', 'n = items.map(x => x + n)', 'computed "n" reads its own name']]);
    expect(marked('computed')).toBe('unsupported');
    expect(text('reader')).toBe('5');
  });

  it('computeds that read each other report the cycle on their element and to each reader, never a TypeError', async () => {
    container.innerHTML = `<div data-forma-state='{"other": 1}'>
      <i id="computed" data-computed="a = b; b = a"></i>
      <p id="ra" data-text="{a}">ssr-a</p>
      <p id="rb" data-text="{b}">ssr-b</p>
      <p id="sibling" data-text="{other + 1}">ssr</p>
    </div>`;
    expect(() => mountFixture(container)).not.toThrow();
    await tick();
    const reason = 'computed "a" is read while it is being computed';
    expect(diagnostics()).toEqual([
      ['FORMA_E_UNSUPPORTED', 'a = b', reason],
      ['FORMA_E_UNSUPPORTED', 'a', reason],
      ['FORMA_E_UNSUPPORTED', 'b', reason],
    ]);
    expect(marked('computed')).toBe('unsupported');
    expect([text('ra'), text('rb')]).toEqual(['ssr-a', 'ssr-b']);
    expect([marked('ra'), marked('rb')]).toEqual(['unsupported', 'unsupported']);
    expect(text('sibling')).toBe('2');
    expect(errors.some((e) => e.includes('TypeError'))).toBe(false);
  });

  it('a cycle through computeds on two elements is reported on the element whose computed it re-entered', async () => {
    container.innerHTML = `<div data-forma-state='{"base": 2}'>
      <i id="first" data-computed="total = base + tax"></i>
      <i id="second" data-computed="tax = total / 10"></i>
      <p id="reader" data-text="{total}">ssr</p>
    </div>`;
    expect(() => mountFixture(container)).not.toThrow();
    await tick();
    expect(diagnostics()).toEqual([
      ['FORMA_E_UNSUPPORTED', 'total = base + tax', 'computed "total" is read while it is being computed'],
      ['FORMA_E_UNSUPPORTED', 'total', 'computed "total" is read while it is being computed'],
    ]);
    expect([marked('first'), marked('second'), marked('reader')]).toEqual(['unsupported', null, 'unsupported']);
    expect(text('reader')).toBe('ssr');
  });

  it('a computed may be named like a state key: a reader bound after it reads the computed, and follows what it reads', async () => {
    // 51 computeds in the app corpora shadow a state key without reading it,
    // the state value a placeholder (forma-generative-ui's focus-timer-card,
    // vector-studio's joke-card, forma-builder's pulse-saas pricing).
    container.innerHTML = `<div data-forma-state='{"count": 1, "other": 3}'>
      <i data-computed="count = other * 2"></i>
      <p id="reader" data-text="{count}">ssr</p>
      <button id="more" data-on:click="{other = 4}">more</button>
      <button id="write" data-on:click="{count = 100}">write</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect(text('reader')).toBe('6');
    (container.querySelector('#more') as HTMLElement).click();
    await tick();
    expect(text('reader')).toBe('8');
    // A write to the name writes the state value the computed hides.
    (container.querySelector('#write') as HTMLElement).click();
    await tick();
    expect(text('reader')).toBe('8');
    expect(diagnostics()).toEqual([]);
  });

  it('a reader before the computed in document order reads the state placeholder until the key is next written', async () => {
    // Elements bind in document order and a reader is evaluated when it binds,
    // so one bound before the computed reads the state key and follows only
    // it. When the key is written it is evaluated again and finds the computed.
    // The same on 5c5a7796 (FORMA-268 review).
    container.innerHTML = `<div data-forma-state='{"count": 1, "other": 3}'>
      <p id="before" data-text="{count}">ssr</p>
      <i id="same" data-computed="count = other * 2" data-text="{count}">ssr</i>
      <p id="after" data-text="{count}">ssr</p>
      <button id="more" data-on:click="{other = 4}">more</button>
      <button id="write" data-on:click="{count = 100}">write</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect([text('before'), text('same'), text('after')]).toEqual(['1', '6', '6']);
    (container.querySelector('#more') as HTMLElement).click();
    await tick();
    expect([text('before'), text('same'), text('after')]).toEqual(['1', '8', '8']);
    (container.querySelector('#write') as HTMLElement).click();
    await tick();
    expect([text('before'), text('same'), text('after')]).toEqual(['8', '8', '8']);
    expect(diagnostics()).toEqual([]);
  });

  it('a cycle that a later change closes, after both computeds have values, is not detected', async () => {
    // Only a read of a computed while it is being evaluated is caught. Here,
    // when `flag` turns true, `a` reads `b`, which answers its cached 2
    // without being evaluated again, so nothing re-enters `a`: a=2, b=2 (not
    // 3), no diagnostic. The same on 5c5a7796 (FORMA-268 review).
    container.innerHTML = `<div data-forma-state='{"flag": false}'>
      <i data-computed="a = flag ? b : 1; b = a + 1"></i>
      <p id="ra" data-text="{a}">ssr-a</p>
      <p id="rb" data-text="{b}">ssr-b</p>
      <button id="on" data-on:click="{flag = true}">on</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect([text('ra'), text('rb')]).toEqual(['1', '2']);
    (container.querySelector('#on') as HTMLElement).click();
    await tick();
    expect([text('ra'), text('rb')]).toEqual(['2', '2']);
    expect(diagnostics()).toEqual([]);
  });

  it('a computed that cached a cycle error keeps it after the cycle breaks', async () => {
    // `b` failed on reading `a` before it read anything that can change, so
    // it depends on nothing and is never evaluated again; `a`, which reads
    // `flag` first, recovers.
    container.innerHTML = `<div data-forma-state='{"flag": true}'>
      <i data-computed="a = flag ? b : 1; b = a + 1"></i>
      <p id="ra" data-text="{a}">ssr-a</p>
      <p id="rb" data-text="{b}">ssr-b</p>
      <button id="off" data-on:click="{flag = false}">off</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect([text('ra'), text('rb')]).toEqual(['ssr-a', 'ssr-b']);
    expect(runtime.getDiagnostics().map((d) => d.expr)).toEqual(['a = flag ? b : 1', 'a', 'b']);
    (container.querySelector('#off') as HTMLElement).click();
    await tick();
    expect([text('ra'), text('rb')]).toEqual(['1', 'ssr-b']);
  });

  it('a handler that a $dispatch in a computed runs, and reads that computed, is refused; the computed still renders', async () => {
    container.innerHTML = `<div data-forma-state='{"n": 0}' data-on:ping="{n = a}">
      <i id="computed" data-computed="a = ($dispatch('ping') ?? 0) + 7"></i>
      <p id="ra" data-text="{a}">ssr-a</p>
      <p id="rn" data-text="{n}">ssr-n</p>
    </div>`;
    expect(() => mountFixture(container)).not.toThrow();
    await tick();
    const reason = 'computed "a" is read while it is being computed';
    expect(diagnostics()).toEqual([
      ['FORMA_E_UNSUPPORTED', "a = ($dispatch('ping') ?? 0) + 7", reason],
      ['FORMA_E_UNSUPPORTED', 'n = a', reason],
    ]);
    expect(marked('computed')).toBe('unsupported');
    expect([text('ra'), text('rn')]).toEqual(['7', '0']);
  });

  it('a list-row computed named after a row local is refused on every row; the row local still renders', async () => {
    // The bind-time check is by name: `item` here would read the row local,
    // which wins over every getter, so on 5c5a7796 this rendered with no
    // diagnostic. Now it is refused, conservatively, on each row.
    container.innerHTML = `<div data-forma-state='{"items": [1, 2, 3]}'>
      <ul data-list="{items}"><li data-computed="item = item * 2" data-text="{item}"></li></ul>
    </div>`;
    mountFixture(container);
    await tick();
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['1', '2', '3']);
    expect(runtime.getDiagnostics().map((d) => [d.code, d.expr, d.reason, d.count]))
      .toEqual([['FORMA_E_UNSUPPORTED', 'item = item * 2', 'computed "item" reads its own name', 3]]);
  });

  it('a computed that cannot compile binds nothing either: a state key of its name keeps rendering', async () => {
    // Before FORMA-268 the binding deleted the state key's getter before it
    // compiled the computed, so a computed that could not compile left every
    // reader of a declared key reporting it undeclared.
    container.innerHTML = `<div data-forma-state='{"n": 5}'>
      <i id="computed" data-computed="n = 1 +"></i>
      <p id="reader" data-text="{n}">ssr</p>
    </div>`;
    mountFixture(container);
    await tick();
    expect(runtime.getDiagnostics().map((d) => [d.code, d.expr])).toEqual([['FORMA_E_SYNTAX', '1 +']]);
    expect(marked('computed')).toBe('unsupported');
    expect(text('reader')).toBe('5');
    expect(marked('reader')).toBeNull();
  });
});
