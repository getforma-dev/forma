import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * Computed self-reference and state-name collisions are refused before binding.
 * Readers retain state identity independent of document order. Existing runtime
 * cycle-detection limits remain explicit regression cases below (FORMA-272).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('data-computed names and cycle limits (FORMA-268, FORMA-272)', () => {
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

  it('a computed colliding with state is refused and state reads and writes keep their identity', async () => {
    container.innerHTML = `<div data-forma-state='{"count": 1, "other": 3}'>
      <i id="computed" data-computed="count = other * 2"></i>
      <p id="reader" data-text="{count}">ssr</p>
      <button id="more" data-on:click="{other = 4}">more</button>
      <button id="write" data-on:click="{count = 100}">write</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect(diagnostics()).toEqual([['FORMA_E_UNSUPPORTED', 'count = other * 2', 'computed "count" conflicts with a state key']]);
    expect(marked('computed')).toBe('unsupported');
    expect(marked('reader')).toBeNull();
    expect(text('reader')).toBe('1');
    (container.querySelector('#more') as HTMLElement).click();
    await tick();
    expect(text('reader')).toBe('1');
    (container.querySelector('#write') as HTMLElement).click();
    await tick();
    expect(text('reader')).toBe('100');
  });

  it('refusing a state-name collision preserves readers before, on and after the declaration', async () => {
    container.innerHTML = `<div data-forma-state='{"count": 1, "other": 3}'>
      <p id="before" data-text="{count}">ssr</p>
      <i id="same" data-computed="count = other * 2" data-text="{count}">ssr</i>
      <p id="after" data-text="{count}">ssr</p>
      <button id="more" data-on:click="{other = 4}">more</button>
      <button id="write" data-on:click="{count = 100}">write</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect(diagnostics()).toEqual([['FORMA_E_UNSUPPORTED', 'count = other * 2', 'computed "count" conflicts with a state key']]);
    expect([text('before'), text('same'), text('after')]).toEqual(['1', '1', '1']);
    (container.querySelector('#more') as HTMLElement).click();
    await tick();
    expect([text('before'), text('same'), text('after')]).toEqual(['1', '1', '1']);
    (container.querySelector('#write') as HTMLElement).click();
    await tick();
    expect([text('before'), text('same'), text('after')]).toEqual(['100', '100', '100']);
  });

  it('a refused collision never evaluates its expression and does not block a distinct derived name', async () => {
    container.innerHTML = `<div data-forma-state='{"count": 2, "events": 0}' data-on:probe="{events++}">
      <i data-computed="count = $dispatch('probe'); doubled = count * 2"></i>
      <p id="reader" data-text="{doubled}">ssr</p>
      <p id="events" data-text="{events}">ssr</p>
      <button id="inc" data-on:click="{count++}">+</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect(diagnostics()).toEqual([['FORMA_E_UNSUPPORTED', "count = $dispatch('probe')", 'computed "count" conflicts with a state key']]);
    expect([text('reader'), text('events')]).toEqual(['4', '0']);
    (container.querySelector('#inc') as HTMLElement).click();
    await tick();
    expect([text('reader'), text('events')]).toEqual(['6', '0']);
  });

  it('a state key and a computed may use the same name in distinct lexical scopes', async () => {
    container.innerHTML = `<div data-forma-state='{"count": 1}'>
      <p id="outer" data-text="{count}">ssr</p>
      <section data-forma-state='{"base": 3}'>
        <i data-computed="count = base * 2"></i>
        <p id="inner" data-text="{count}">ssr</p>
        <button id="inner-inc" data-on:click="{base++}">+</button>
      </section>
      <button id="outer-inc" data-on:click="{count++}">+</button>
    </div>`;
    mountFixture(container);
    await tick();
    expect([text('outer'), text('inner')]).toEqual(['1', '6']);
    (container.querySelector('#inner-inc') as HTMLElement).click();
    (container.querySelector('#outer-inc') as HTMLElement).click();
    await tick();
    expect([text('outer'), text('inner')]).toEqual(['2', '8']);
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
