import { mountFixture, unmountFixture, updateFixture } from './runtime-fixture';
/**
 * FORMA-274: the paths FORMA-271 left by which markup could still throw out of
 * `mountMarkup`, or fail at event time as an uncaught page error.
 *
 * FORMA-271 made an allowlisted native's own throw a coded
 * `FORMA_E_CALL_FAILED`. Its review listed what still escaped: the runtime's
 * own DOM writes (a `data-bind:` or `data-class:` with no name, `data-model`
 * on a file input), a value nested about 10,000 deep converted by anything
 * but the native (`data-text`, an operator, Forma's own argument checks, a
 * sort comparator's result), event-time property writes the browser refuses,
 * a DOM method's rejected promise, and the wrapper's own `String(e)`. Each is
 * now a coded diagnostic on the binding that met it, and the rest of the
 * module binds and works.
 *
 * In happy-dom, `dispatchEvent` and `click()` hand a listener's exception back
 * to the caller (a browser reports it as an uncaught error instead), so an
 * event-time throw shows up here as a throw from `dispatchEvent`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';
import { onError } from '../reactive';
import { HOSTILE_BODIES, HOSTILE_VALUES, hostileModule } from './hostile-markup';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** `levels` arrays, each the only element of the one before, around a 0. */
const nested = (levels: number): string => '['.repeat(levels) + '0' + ']'.repeat(levels);

let container: HTMLDivElement;
let swallowed: unknown[];
let stopWatching: () => void;

beforeEach(async () => {
  await tick();
  runtime.clearDiagnostics();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // A binding's later run that throws is not a throw out of anything: the
  // reactive flush catches it and hands it to onError() only (and the console
  // in a development build). Watched here, so such a run cannot pass silently.
  swallowed = [];
  stopWatching = onError((e) => { swallowed.push(e); });
  container = document.createElement('div');
  document.body.appendChild(container);
  try { localStorage.clear(); } catch { /* none */ }
});

afterEach(async () => {
  stopWatching();
  unmountFixture(container);
  container.remove();
  await tick();
  runtime.clearDiagnostics();
  vi.restoreAllMocks();
});

const el = (id: string): Element => container.querySelector(`#${id}`)!;
const codes = (): Array<[string, string]> => runtime.getDiagnostics().map((d) => [d.code, d.expr]);
const reasons = (): string[] => runtime.getDiagnostics().map((d) => d.reason);

/** Mount `body` in one scope with `state`, and say what escaped. */
function mount(body: string, state = '{}', grants: Parameters<typeof mountFixture>[1] = {}): unknown {
  container.innerHTML = `<div data-forma-state='${state}'>${body}<p id="ok" data-text="{1 + 1}">ok</p></div>`;
  try {
    mountFixture(container, grants);
    return null;
  } catch (e) {
    return e;
  }
}

describe("the runtime's own DOM writes (FORMA-274, item 1)", () => {
  it('a data-bind: or data-class: with no name is refused at bind time with FORMA_E_UNSUPPORTED, and the rest of the module mounts', () => {
    expect(mount('<p id="b" data-bind:="{1}">b</p><p id="c" data-class:="{true}">c</p>')).toBeNull();
    expect(codes()).toEqual([
      ['FORMA_E_UNSUPPORTED', 'data-bind:="{1}"'],
      ['FORMA_E_UNSUPPORTED', 'data-class:="{true}"'],
    ]);
    expect(reasons()).toEqual(['data-bind: has no name', 'data-class: has no name']);
    expect(el('b').getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(el('c').getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(el('c').getAttribute('class')).toBeNull();
    expect(el('ok').textContent).toBe('2');
  });

  it.each([
    ['<input id="t" type="file" data-model="{v}">', 'InvalidStateError'],
    ['<progress id="t" data-model="{v}"></progress>', 'TypeError'],
    ['<meter id="t" data-model="{v}"></meter>', 'TypeError'],
  ])("a write the browser refuses is reported on its element, at mount and on a later run: %s", async (body, name) => {
    expect(mount(body, '{"v": "x"}')).toBeNull();
    expect(codes()).toEqual([['FORMA_E_CALL_FAILED', 'v']]);
    expect(reasons()[0]!.startsWith(`data-model write threw ${name}: `), reasons()[0]).toBe(true);
    expect(el('t').getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(el('ok').textContent).toBe('2');
    // A later run is reported too, where it used to go to onError() only.
    runtime.clearDiagnostics();
    el('t').removeAttribute('data-forma-expr-error');
    runtime.setScopeValue(container.firstElementChild!, 'v', 'y');
    await tick();
    expect(codes()).toEqual([['FORMA_E_CALL_FAILED', 'v']]);
    expect(swallowed).toEqual([]);
  });

  it('what a write is handed is checked and charged before it is written, so the write itself is all the wrapper catches', () => {
    // A real bug in the runtime before the write is not filed as the write's.
    const boom = new RangeError('a real bug');
    expect(mount('<p id="t" data-text="{v}">x</p>', '{"v": 1}')).toBeNull();
    const scope = (container.firstElementChild as unknown as { __formaScope: { getters: Record<string, () => unknown> } }).__formaScope;
    scope.getters.v = () => { throw boom; };
    runtime.setScopeValue(container.firstElementChild!, 'v', 2);
    expect(swallowed).toEqual([boom]);
    expect(codes()).toEqual([]);
  });
});

describe('values nested too deep are refused before anything converts them (FORMA-274, item 2)', () => {
  const DEEP = nested(10_000);
  const refused = 'a value nested more than 100 deep is refused';

  it.each([
    ['data-text', '<p id="t" data-text="{d}">kept</p>'],
    ['an operator', `<p id="t" data-text="{'' + d}">kept</p>`],
    ['a template literal', '<p id="t" data-text="{`${d}`}">kept</p>'],
    ['a comparison', '<p id="t" data-text="{d < 1}">kept</p>'],
    ['$el.matches (a selector check)', '<p id="t" data-text="{$el.matches(d)}">kept</p>'],
    ['$el.setAttribute (its name)', `<p id="t" data-text="{$el.setAttribute(d, 'x')}">kept</p>`],
    ['$el.setAttribute (its value)', `<p id="t" data-text="{$el.setAttribute('title', d)}">kept</p>`],
    ['$el.toggleAttribute', '<p id="t" data-text="{$el.toggleAttribute(d)}">kept</p>'],
    ['style.setProperty', `<p id="t" data-text="{$el.style.setProperty(d, 'x')}">kept</p>`],
    ['repeat (its count)', `<p id="t" data-text="{'x'.repeat(d)}">kept</p>`],
    ['flat (its depth)', '<p id="t" data-text="{[1].flat(d)}">kept</p>'],
    ['replace (its cost row)', `<p id="t" data-text="{'x'.replace(d, 'y')}">kept</p>`],
    ['a sort comparator', '<p id="t" data-text="{[1, 2].sort((a, b) => d)}">kept</p>'],
    ['String()', '<p id="t" data-text="{String(d)}">kept</p>'],
    ['JSON.stringify', '<p id="t" data-text="{JSON.stringify(d)}">kept</p>'],
    ['data-bind:', '<p id="t" data-bind:title="{d}">kept</p>'],
    ['data-model', '<input id="t" data-model="{d}">'],
    ['a data-list row', '<ul id="t" data-list="{[d]}"><li>{item}</li></ul>'],
  ])('%s of a value nested 10,000 deep is refused with FORMA_E_BUDGET on its element', (_, body) => {
    expect(mount(body, `{"d": ${DEEP}}`)).toBeNull();
    expect(runtime.getDiagnostics().map((d) => [d.code, d.reason])).toEqual([['FORMA_E_BUDGET', refused]]);
    expect(el('t').getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(el('ok').textContent).toBe('2');
  });

  it('a value an expression builds itself is refused the same way: no entry point sees it', () => {
    // 10,000 levels in 30,000 steps: within every budget, past V8's stack.
    expect(mount(`
      <p id="t" data-text="{Array.from({length: 10000}).reduce(a => [a], 0)}">kept</p>
      <p id="s" data-text="{[1, 2].sort((a, b) => Array.from({length: 10000}).reduce(x => [x], 0))}">kept</p>`)).toBeNull();
    expect(runtime.getDiagnostics().map((d) => [d.code, d.reason])).toEqual([['FORMA_E_BUDGET', refused], ['FORMA_E_BUDGET', refused]]);
    expect(el('t').textContent).toBe('kept');
    expect(el('s').textContent).toBe('kept');
  });

  it('a deep value from data-fetch, data-persist, setScopeValue or a handler write is refused where it is converted', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(DEEP, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    localStorage.setItem('forma:p', DEEP);
    try {
      expect(mount(`
        <div data-fetch="/api/deep → r"><p id="f" data-text="{r}">f</p></div>
        <p id="p" data-persist="{p}" data-text="{p}">p</p>
        <p id="s" data-text="{s}">s</p>
        <button id="h" data-on:go="{o.self = o; n++}"></button><p id="o" data-text="{n + '' + o}">o</p>`,
      '{"p": 0, "s": 0, "n": 0, "o": {"a": 1}}', { grants: { fetch: { paths: ['/api/'] } } })).toBeNull();
      expect(el('o').textContent).toBe('0[object Object]');
      runtime.setScopeValue(container.firstElementChild!, 's', JSON.parse(DEEP));
      // A handler makes a cyclic object: the binding that reads it re-runs
      // when `n` changes, and refuses it.
      el('h').dispatchEvent(new Event('go'));
      for (let i = 0; i < 5; i++) await tick();
    } finally {
      globalThis.fetch = realFetch;
    }
    const refusedOn = runtime.getDiagnostics().filter((d) => d.code === 'FORMA_E_BUDGET').map((d) => d.expr).sort();
    expect(refusedOn).toEqual(["n + '' + o", 'p', 'r', 's']);
    for (const id of ['f', 'p', 's', 'o']) expect(el(id).getAttribute('data-forma-expr-error'), id).toBe('unsupported');
    expect(swallowed).toEqual([]);
  });

  it('a value 100 deep renders and one 101 deep is refused; the deepest state and fixtures found in the app corpora render', () => {
    expect(mount('<p id="a" data-text="{a}">a</p><p id="b" data-text="{b}">b</p><p id="c" data-text="{JSON.stringify(c).length}">c</p>',
      `{"a": ${nested(100)}, "b": ${nested(101)}, "c": ${'{"k":'.repeat(23)}[1]${'}'.repeat(23)}}`)).toBeNull();
    expect(el('a').textContent).toBe('0');
    expect(el('b').textContent).toBe('b');
    expect(el('c').textContent).toBe(String(JSON.stringify(JSON.parse(`${'{"k":'.repeat(23)}[1]${'}'.repeat(23)}`)).length));
    expect(runtime.getDiagnostics().map((d) => [d.code, d.expr])).toEqual([['FORMA_E_BUDGET', 'b']]);
  });
});

describe("an object whose own toString is not a function, which JSON can send (FORMA-274)", () => {
  it('is refused with FORMA_E_CALL_FAILED before anything converts it, where it threw a TypeError out of mountMarkup and the handler', () => {
    // `{"toString": 1}` shadows Object.prototype.toString with a number, so
    // converting the object to text or a number throws.
    expect(mount(`
      <p id="a" data-text="{'' + t}">a</p>
      <p id="b" data-text="{t}">b</p>
      <p id="c" data-bind:title="{t}">c</p>
      <p id="d" data-text="{$el.setAttribute(t, 'x')}">d</p>
      <p id="e" data-text="{o[t]}">e</p>
      <ul id="f" data-list="{[{id: t}]}"><li data-key="{item.id}">f</li></ul>
      <p id="g" data-on:go="{$el.style.color = t}">g</p>`, '{"t": {"toString": 1}, "o": {}}')).toBeNull();
    expect(() => el('g').dispatchEvent(new Event('go'))).not.toThrow();
    // data-text and data-bind: report the same expression once, counted twice.
    expect(runtime.getDiagnostics().map((d) => [d.code, d.expr, d.count, d.reason])).toEqual(
      ["'' + t", 't', "$el.setAttribute(t, 'x')", 'o[t]', '[{id: t}]', '$el.style.color = t'].map((expr) =>
        ['FORMA_E_CALL_FAILED', expr, expr === 't' ? 2 : 1, 'an object whose toString is not a function cannot be converted']),
    );
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) expect(el(id).getAttribute('data-forma-expr-error'), id).toBe('unsupported');
    expect(el('g').getAttribute('data-forma-handler-error')).toBe('unsupported');
    expect(el('ok').textContent).toBe('2');
  });

  it('an object of the application with its own toString function still converts, and what that function throws is the native call that threw', () => {
    expect(mount('<p id="a" data-text="{String(v)}">a</p><p id="b" data-text="{w}">b</p>', '{"v": 0, "w": 0}')).toBeNull();
    runtime.setScopeValue(container.firstElementChild!, 'v', { toString() { throw new TypeError('app'); } });
    runtime.setScopeValue(container.firstElementChild!, 'w', { toString: () => 'Ada' });
    expect(el('b').textContent).toBe('Ada');
    expect(runtime.getDiagnostics().map((d) => [d.code, d.reason])).toEqual([['FORMA_E_CALL_FAILED', 'String() threw TypeError: app']]);
  });
});

describe('event-time host property writes (FORMA-274, item 3)', () => {
  it.each([
    [`<input id="t" type="file" data-on:go="{$el.value = 'x'}">`, "$el.value = … threw InvalidStateError: "],
    [`<progress id="t" data-on:go="{$el.value = 'abc'}"></progress>`, '$el.value = … threw TypeError: '],
    [`<meter id="t" data-on:go="{$el.value = 'abc'}"></meter>`, '$el.value = … threw TypeError: '],
    [`<progress id="t" data-on:go="{$el.max = 'abc'}"></progress>`, '$el.max = … threw TypeError: '],
    [`<meter id="t" data-on:go="{$el.min = 'abc'}"></meter>`, '$el.min = … threw TypeError: '],
  ])('%s is reported on its element as FORMA_E_CALL_FAILED, not thrown to the event', (body, reason) => {
    expect(mount(`${body}<button id="inc" data-on:go="{n++}"></button><p id="n" data-text="{n}"></p>`, '{"n": 0}')).toBeNull();
    expect(() => el('t').dispatchEvent(new Event('go'))).not.toThrow();
    el('inc').dispatchEvent(new Event('go'));
    expect(runtime.getDiagnostics().map((d) => [d.kind, d.code])).toEqual([['handler-unsupported', 'FORMA_E_CALL_FAILED']]);
    expect(reasons()[0]!.startsWith(reason), reasons()[0]).toBe(true);
    expect(el('t').getAttribute('data-forma-handler-error')).toBe('unsupported');
    expect(el('n').textContent).toBe('1');
  });
});

describe('a DOM method that answers a rejected promise (FORMA-274, item 4)', () => {
  it('the rejection is reported on the element, not left unhandled', async () => {
    expect(mount('<p id="t" data-on:go="{$el.scrollIntoView()}">x</p><p id="v" data-text="{n > 0 ? $el.scrollIntoView() : 0}">v</p>', '{"n": 0}')).toBeNull();
    // Chromium 156 rejects `scrollIntoView({behavior: 'bad'})`; happy-dom's
    // never does, so the element's method is the application's here.
    for (const id of ['t', 'v']) {
      (el(id) as unknown as { scrollIntoView: () => Promise<never> }).scrollIntoView = () => Promise.reject(new TypeError(`bad behavior ${id}`));
    }
    runtime.setScopeValue(container.firstElementChild!, 'n', 1);
    el('t').dispatchEvent(new Event('go'));
    for (let i = 0; i < 3; i++) await tick();
    expect(runtime.getDiagnostics().map((d) => [d.kind, d.code, d.expr, d.reason])).toEqual([
      ['expression-unsupported', 'FORMA_E_CALL_FAILED', '$el.scrollIntoView', '$el.scrollIntoView() rejected TypeError: bad behavior v'],
      ['handler-unsupported', 'FORMA_E_CALL_FAILED', '$el.scrollIntoView()', '$el.scrollIntoView() rejected TypeError: bad behavior t'],
    ]);
    expect(el('v').getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(el('t').getAttribute('data-forma-handler-error')).toBe('unsupported');
  });
});

describe("what application code throws through a native, unconvertible to text (FORMA-274, item 5)", () => {
  it.each([
    ['Object.create(null)', () => Object.create(null)],
    ['an object whose toString throws', () => ({ toString() { throw new Error('inner'); } })],
  ])('%s is reported as FORMA_E_CALL_FAILED, not a TypeError out of the handler', (_, thrown) => {
    expect(mount('<p id="t" data-on:go="{x = String(v)}">x</p>', '{"v": 0, "x": 0}')).toBeNull();
    runtime.setScopeValue(container.firstElementChild!, 'v', { toString() { throw thrown(); } });
    expect(() => el('t').dispatchEvent(new Event('go'))).not.toThrow();
    expect(runtime.getDiagnostics().map((d) => [d.code, d.reason])).toEqual([['FORMA_E_CALL_FAILED', 'String() threw an unprintable value']]);
  });
});

describe('evaluations nested inside one another are capped (FORMA-274)', () => {
  const chain = (n: number): string => {
    const parts: string[] = [];
    for (let i = n - 1; i >= 1; i--) parts.push(`a${i} = a${i - 1} + 1`);
    parts.push('a0 = 1');
    return `<i data-computed="${parts.join('; ')}"></i><p id="t" data-text="{a${n - 1}}">kept</p>`;
  };

  it('a chain of 31 computeds read by a binding renders; one of 32 is refused with FORMA_E_BUDGET, never a stack overflow', () => {
    expect(mount(chain(31))).toBeNull();
    expect(el('t').textContent).toBe('31');
    expect(codes()).toEqual([]);
    unmountFixture(container);
    expect(mount(chain(32))).toBeNull();
    expect(el('t').textContent).toBe('kept');
    expect(runtime.getDiagnostics().map((d) => [d.code, d.reason])).toContainEqual(['FORMA_E_BUDGET', 'evaluations nested more than 32 deep are refused']);
    // A chain long enough to overflow the stack of every engine is refused the same way.
    unmountFixture(container);
    runtime.clearDiagnostics();
    expect(mount(chain(3000))).toBeNull();
    expect(el('t').textContent).toBe('kept');
  });

  it('a handler that dispatches its own event to itself stops at the cap, with one diagnostic', () => {
    expect(mount(`<div id="t" data-on:ping="{n++; $dispatch('ping')}"><p id="go" data-text="{$dispatch('ping')}">x</p></div><p id="n" data-text="{n}"></p>`, '{"n": 0}')).toBeNull();
    expect(runtime.getDiagnostics().map((d) => [d.kind, d.code, d.reason])).toEqual([
      ['handler-unsupported', 'FORMA_E_BUDGET', 'evaluations nested more than 32 deep are refused'],
    ]);
    expect(el('n').textContent).toBe('31');
  });
});

describe("the grammar's depth limits (FORMA-274's search)", () => {
  it("the grammar's own depth limits hold for 4,000-character chains: each is a coded FORMA_E_LIMIT, never a stack overflow", () => {
    // A chain the parser recurses on before it counts a node.
    const chains = [
      `{${'!'.repeat(4090)}1}`,
      `{${'typeof '.repeat(580)}1}`,
      `{${'- '.repeat(2040)}1}`,
      `{${'('.repeat(2040)}1${')'.repeat(2040)}}`,
      `{${'['.repeat(2040)}1${']'.repeat(2040)}}`,
    ];
    const body = chains.map((c, i) => `<p id="c${i}" data-text="${c}">x</p>`).join('')
      + `<p id="h" data-on:go="{${'if (n) '.repeat(580)}n++}">h</p>`;
    expect(mount(body, '{"n": 1}')).toBeNull();
    expect(() => el('h').dispatchEvent(new Event('go'))).not.toThrow();
    expect(runtime.getDiagnostics().map((d) => d.code)).toEqual(Array(6).fill('FORMA_E_LIMIT'));
  });
});

describe('markup cannot throw out of mountMarkup (FORMA-274, item 8)', () => {
  /** Ticks until the diagnostics stop changing: budget refusals report one heavy binding a task. */
  const settle = async (): Promise<void> => {
    let last = -1;
    for (let quiet = 0, i = 0; quiet < 3 && i < 400; i++) {
      await tick();
      const n = runtime.getDiagnostics().reduce((sum, d) => sum + d.count, 0);
      quiet = n === last ? quiet + 1 : 0;
      last = n;
    }
  };

  it.each(Object.entries(HOSTILE_VALUES))('every directive given %s: nothing throws out of mountMarkup, an event or a later run, and every failure is coded', async (_, json) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(json, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      container.innerHTML = hostileModule(json);
      expect(() => mountFixture(container, { grants: { dom: true, fetch: { paths: ['/api/'] } } })).not.toThrow();
      const handlers = [...container.querySelectorAll('[data-on\\:go]')];
      expect(handlers.length).toBe(HOSTILE_BODIES.filter((b) => b.includes('data-on:go')).length);
      // happy-dom hands a listener's exception back to dispatchEvent, so an
      // uncaught error at event time would throw here.
      for (const el of handlers) expect(() => el.dispatchEvent(new Event('go'))).not.toThrow();
      await settle();
      // The same bindings run again on values that arrive later.
      const scopeEl = container.firstElementChild!;
      for (const later of [HOSTILE_VALUES['arrays nested 10,000 deep']!, '"#1"', json]) {
        expect(() => runtime.setScopeValue(scopeEl, 'v', JSON.parse(later))).not.toThrow();
        await settle();
      }
      // And through the mount's update(), which binds what it adds.
      expect(() => updateFixture(container, runtime.trustedHtml(hostileModule(json).replace('<div id="b0">', '<div id="b0"><b data-text="{v}"></b>')))).not.toThrow();
      await settle();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(swallowed, 'no binding threw on a later run').toEqual([]);
    for (const d of runtime.getDiagnostics()) expect(d.code, d.reason).toMatch(/^FORMA_E_[A-Z_]+$/);
    // The module beside them still works.
    el('inc').dispatchEvent(new Event('ping'));
    expect(el('count').textContent).toBe('1');
  }, 60_000);
});
