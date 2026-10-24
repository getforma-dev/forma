/**
 * FORMA-279: the children of a `data-if` that is false when its scope mounts.
 *
 * The data-if's binding removes its element while mountScope is still walking
 * its snapshot of the scope, and the walk skipped every node no longer inside
 * the scope root (the check that keeps a `data-list` row template out of the
 * parent scope). So nothing inside the branch was bound: after the condition
 * turned true its text, classes, attributes, inputs and handlers stayed as
 * the markup wrote them, a nested data-if showed whatever its condition, a
 * `data-list` showed its raw template, and a scope nested in the branch never
 * mounted. A branch that is true at mount binds its children once and keeps
 * them bound while it is hidden; one that starts false now does the same.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountHandle } from '../runtime';

let runtime: typeof import('../runtime');
let reactive: typeof import('../reactive');
const handles: MountHandle[] = [];

beforeEach(async () => {
  vi.resetModules();
  runtime = await import('../runtime');
  reactive = await import('../reactive');
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
  localStorage.clear();
});

type Scope = { getters: Record<string, () => unknown>; setters: Record<string, (v: unknown) => void> };
interface Mounted {
  root: HTMLElement;
  scope: Scope;
  handle: MountHandle;
  q: (selector: string) => HTMLElement | null;
  texts: (selector: string) => string[];
  codes: () => string[];
}

function mount(state: Record<string, unknown>, body: string, grants: Record<string, unknown> = {}): Mounted {
  const root = document.createElement('div');
  document.body.append(root);
  runtime.clearDiagnostics();
  const handle = runtime.mountMarkup(root, runtime.trustedHtml(
    `<section data-forma-state='${JSON.stringify(state)}'>${body}</section>`,
  ), { tier: 'reviewed', grants });
  handles.push(handle);
  const scope = (root.firstElementChild as unknown as { __formaScope: Scope }).__formaScope;
  return {
    root,
    scope,
    handle,
    q: (selector) => root.querySelector<HTMLElement>(selector),
    texts: (selector) => [...root.querySelectorAll(selector)].map((el) => el.textContent ?? ''),
    codes: () => runtime.getDiagnostics().map((d) => d.code),
  };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

interface DirectiveCase {
  name: string;
  state: Record<string, unknown>;
  branch: string;
  after?: string;
  setup?: () => void;
  /** Runs after the branch first shows; returns what it observed. */
  observe: (m: Mounted) => unknown[];
  expected: unknown[];
}

const CASES: DirectiveCase[] = [
  {
    name: 'data-text',
    state: { msg: 'a' },
    branch: '<span id="t" data-text="{msg}">stale</span>',
    observe: (m) => { const first = m.q('#t')!.textContent; m.scope.setters.msg('b'); return [first, m.q('#t')!.textContent]; },
    expected: ['a', 'b'],
  },
  {
    name: 'a data-text two levels down',
    state: { msg: 'a' },
    branch: '<p><em><span id="t" data-text="{msg}">stale</span></em></p>',
    observe: (m) => { const first = m.q('#t')!.textContent; m.scope.setters.msg('b'); return [first, m.q('#t')!.textContent]; },
    expected: ['a', 'b'],
  },
  {
    name: 'data-show',
    state: { n: 0 },
    branch: '<span id="t" data-show="{n > 0}">x</span>',
    observe: (m) => { const first = m.q('#t')!.style.display; m.scope.setters.n(1); return [first, m.q('#t')!.style.display]; },
    expected: ['none', ''],
  },
  {
    name: 'data-class:',
    state: { hot: false },
    branch: '<span id="t" data-class:hot="{hot}">x</span>',
    observe: (m) => { m.scope.setters.hot(true); const on = m.q('#t')!.className; m.scope.setters.hot(false); return [on, m.q('#t')!.className]; },
    expected: ['hot', ''],
  },
  {
    name: 'data-bind:',
    state: { msg: 'a' },
    branch: '<a id="t" data-bind:title="{msg}">x</a>',
    observe: (m) => { const first = m.q('#t')!.title; m.scope.setters.msg('b'); return [first, m.q('#t')!.title]; },
    expected: ['a', 'b'],
  },
  {
    name: 'data-model',
    state: { v: 'm' },
    branch: '<input id="t" data-model="{v}">',
    after: '<output id="o" data-text="{v}"></output>',
    observe: (m) => {
      const input = m.q('#t') as HTMLInputElement;
      const first = input.value;
      type(input, 'typed');
      const typed = [m.scope.getters.v(), m.q('#o')!.textContent];
      m.scope.setters.v('z');
      return [first, ...typed, input.value];
    },
    expected: ['m', 'typed', 'typed', 'z'],
  },
  {
    name: 'data-on:',
    state: { n: 0 },
    branch: '<button id="t" data-on:click="{n++}">+</button>',
    observe: (m) => { m.q('#t')!.click(); m.q('#t')!.click(); return [m.scope.getters.n()]; },
    expected: [2],
  },
  {
    name: 'data-computed, read inside the branch and after it',
    state: { msg: 'a' },
    branch: `<span id="t" data-computed="loud = msg + '!'" data-text="{loud}">stale</span>`,
    after: '<output id="o" data-text="{loud}">stale</output>',
    observe: (m) => {
      const first = [m.q('#t')!.textContent, m.q('#o')!.textContent];
      m.scope.setters.msg('b');
      return [...first, m.q('#t')!.textContent, m.q('#o')!.textContent];
    },
    expected: ['a!', 'a!', 'b!', 'b!'],
  },
  {
    name: 'a nested data-if',
    state: { inner: false },
    branch: '<p id="t" data-if="{inner}">inner</p>',
    observe: (m) => { const first = m.q('#t'); m.scope.setters.inner(true); return [first, m.q('#t')?.textContent]; },
    expected: [null, 'inner'],
  },
  {
    name: 'data-list',
    state: { items: ['x'] },
    branch: '<ul data-list="{items}"><li data-text="{item}">template</li></ul>',
    observe: (m) => { const first = m.texts('li'); m.scope.setters.items(['x', 'y']); return [first, m.texts('li')]; },
    expected: [['x'], ['x', 'y']],
  },
  {
    name: 'data-persist',
    state: { saved: 'initial' },
    branch: '<input data-persist="{saved}">',
    setup: () => localStorage.setItem('forma:saved', JSON.stringify('restored')),
    observe: (m) => { const first = m.scope.getters.saved(); m.scope.setters.saved('next'); return [first, localStorage.getItem('forma:saved')]; },
    expected: ['restored', '"next"'],
  },
];

describe.each([false, true])('a data-if that is %s at mount', (start) => {
  it.each(CASES.map((c) => [c.name, c] as const))('binds %s in its branch: it renders and updates once the branch shows', (_name, c) => {
    c.setup?.();
    const m = mount({ ...c.state, on: start }, `<div data-if="{on}">${c.branch}</div>${c.after ?? ''}`);
    m.scope.setters.on(true);
    expect(c.observe(m)).toEqual(c.expected);
    expect(m.codes()).toEqual([]);
  });
});

it('nested data-ifs that are both false at mount each bind, and the inner one binds its own children', () => {
  const m = mount({ outer: false, inner: false, msg: 'a' },
    '<div data-if="{outer}"><p data-if="{inner}"><b id="t" data-text="{msg}">stale</b></p></div>');
  m.scope.setters.outer(true);
  expect(m.q('#t')).toBeNull();
  m.scope.setters.inner(true);
  expect(m.q('#t')!.textContent).toBe('a');
  m.scope.setters.msg('b');
  expect(m.q('#t')!.textContent).toBe('b');
  m.scope.setters.outer(false);
  m.scope.setters.msg('c');
  m.scope.setters.outer(true);
  expect(m.q('#t')!.textContent).toBe('c');
  expect(m.codes()).toEqual([]);
});

it('a data-list row template inside a data-if that starts false is still bound only in its rows', () => {
  // The skip this fix narrows exists for this template (failure-semantics.test.ts).
  const m = mount({ on: false, rows: [{ label: 'a' }, { label: 'b' }] },
    '<div data-if="{on}"><ul data-list="{rows}"><li><span data-text="{item.label}"></span></li></ul></div>');
  expect(m.codes()).toEqual([]);
  m.scope.setters.on(true);
  expect(m.texts('li span')).toEqual(['a', 'b']);
  expect(m.codes()).toEqual([]);
});

it('a data-if in a data-list row, and a row template that carries a data-if, bind as before', () => {
  const m = mount({ on: false, msg: 'a', rows: [{ id: 1, shown: false }] },
    '<ul id="a" data-list="{rows}"><li><b data-if="{on}"><i data-text="{msg}">stale</i></b></li></ul>'
    + '<ul id="b" data-list="{rows}"><li data-key="{item.id}" data-if="{item.shown}"><i data-text="{msg}">stale</i></li></ul>');
  m.scope.setters.on(true);
  m.scope.setters.rows([{ id: 1, shown: true }]);
  m.scope.setters.msg('b');
  expect(m.texts('#a i')).toEqual(['b']);
  expect(m.texts('#b i')).toEqual(['b']);
  expect(m.codes()).toEqual([]);
});

it('a data-if with an enter transition that starts false binds its children before they enter', async () => {
  vi.useFakeTimers();
  const m = mount({ on: false, msg: 'a' },
    '<div id="box" data-if="{on}" data-transition:enter="fade 50ms"><span id="t" data-text="{msg}">stale</span></div>');
  m.scope.setters.on(true);
  expect(m.q('#box')!.classList.contains('fade')).toBe(true);
  expect(m.q('#t')!.textContent).toBe('a');
  await vi.advanceTimersByTimeAsync(100);
  m.scope.setters.msg('b');
  expect(m.q('#t')!.textContent).toBe('b');
});

it('a scope nested in a data-if that starts false mounts, as one in a branch that starts true does', () => {
  const observe = (start: boolean): unknown[] => {
    const m = mount({ on: start, msg: 'outer' },
      `<div data-if="{on}"><article data-forma-state='{"msg":"inner","n":0}'>`
      + '<span id="t" data-text="{msg}">stale</span><button data-on:click="{n++}">+</button><b id="n" data-text="{n}">stale</b></article></div>');
    m.scope.setters.on(true);
    const shown = [m.q('#t')!.textContent, m.q('#n')!.textContent];
    m.q('button')!.click();
    const seen = [...shown, m.q('#n')!.textContent, m.codes()];
    m.handle.unmount();
    return seen;
  };
  const fromFalse = observe(false);
  expect(fromFalse.slice(0, 3)).toEqual(['inner', '0', '1']);
  expect(fromFalse).toEqual(observe(true));
});

it('a data-fetch in a data-if that starts false requests when its scope mounts, as one in a branch that starts true does', async () => {
  const requested: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    requested.push(url);
    return Promise.resolve({ ok: true, status: 200, json: async () => 'loaded' } as Response);
  });
  const seen: unknown[] = [];
  for (const start of [false, true]) {
    const m = mount({ on: start },
      '<div data-if="{on}"><div data-fetch="GET /api/items → items"></div><p id="t" data-text="{items}"></p></div>',
      { fetch: { paths: ['/api/'] } });
    const atMount = requested.length;
    await new Promise((resolve) => setTimeout(resolve, 0));
    m.scope.setters.on(true);
    seen.push([atMount, m.q('#t')!.textContent]);
    m.handle.unmount();
  }
  expect(seen).toEqual([[1, 'loaded'], [2, 'loaded']]);
  expect(requested).toEqual(['/api/items', '/api/items']);
});

it('a binding in a branch hidden at mount that reaches another element through $el runs while the branch is out of the document', () => {
  // The branch is bound at mount, as one that starts true is, but outside the
  // document: an element it reaches is outside the mount root then, so the
  // hop is refused without the dom grant, and closest() answers null. A
  // branch that starts true and is hidden when such a binding re-runs is the same.
  const m = mount({ on: false },
    '<div id="p" data-if="{on}"><span id="kid" data-text="{$el.firstElementChild.id}"><b></b></span>'
    + `<i id="near" data-text="{$el.closest('div')?.id ?? 'none'}">stale</i></div>`);
  expect(runtime.getDiagnostics().map((d) => [d.code, d.expr])).toEqual([['FORMA_E_GRANT_DOM', '$el.firstElementChild.id']]);
  m.scope.setters.on(true);
  expect([m.q('#kid')!.innerHTML, m.q('#near')!.textContent]).toEqual(['<b></b>', 'none']);
});

it('with the dom grant, closest() in a branch hidden at mount reaches the held element, and the grant report records dom from mount', () => {
  // FORMA-287: the null above holds only without the grant.
  const m = mount({ on: false },
    `<div id="p" data-if="{on}"><i id="near" data-text="{$el.closest('div')?.id ?? 'none'}">stale</i></div>`, { dom: true });
  expect(m.codes()).toEqual([]);
  expect(m.handle.grantsUsed()).toEqual({ dom: true });
  m.scope.setters.on(true);
  expect(m.q('#near')!.textContent).toBe('p');
});

describe('binding a branch that starts false once', () => {
  /** Live internal effects, and live listeners on elements under `root`. */
  function meter() {
    const effects = new Set<object>();
    const internalEffect = reactive.internalEffect;
    vi.spyOn(reactive, 'internalEffect').mockImplementation((fn) => {
      const token = {};
      effects.add(token);
      const dispose = internalEffect(fn);
      return () => { effects.delete(token); dispose(); };
    });
    // The prototype an element actually inherits its listener methods from.
    let target: EventTarget = document.createElement('div');
    while (!Object.hasOwn(target, 'addEventListener')) target = Object.getPrototypeOf(target);
    let listeners = 0;
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    vi.spyOn(target, 'addEventListener').mockImplementation(function (this: EventTarget, ...args) {
      if (this instanceof Element) listeners++;
      return Reflect.apply(add, this, args);
    });
    vi.spyOn(target, 'removeEventListener').mockImplementation(function (this: EventTarget, ...args) {
      if (this instanceof Element) listeners--;
      return Reflect.apply(remove, this, args);
    });
    return { effects: () => effects.size, listeners: () => listeners };
  }

  const BODY = '<div data-if="{on}"><button data-on:click="{n++}">+</button><span data-text="{n}"></span><input data-model="{v}"></div>'
    + '<output data-text="{n}"></output>';

  it('makes the bindings a branch that starts true makes, and toggling it 50 times adds none', () => {
    const counted = (start: boolean) => {
      const m = meter();
      const mounted = mount({ on: start, n: 0, v: '' }, BODY);
      const atMount = [m.effects(), m.listeners()];
      for (let i = 0; i < 50; i++) { mounted.scope.setters.on(!start); mounted.scope.setters.on(start); }
      mounted.scope.setters.on(true);
      const afterToggles = [m.effects(), m.listeners()];
      mounted.q('button')!.click();
      const result = { atMount, afterToggles, n: mounted.scope.getters.n(), text: mounted.q('span')!.textContent };
      mounted.handle.unmount();
      vi.restoreAllMocks();
      return result;
    };
    // The data-if, the span, the input and the output; the button's and the input's listener.
    const expected = { atMount: [4, 2], afterToggles: [4, 2], n: 1, text: '1' };
    expect(counted(false)).toEqual(expected);
    expect(counted(true)).toEqual(expected);
  });

  it('unmounting while the branch is hidden disposes every binding in it', () => {
    const m = meter();
    const mounted = mount({ on: false, n: 0, v: '' }, BODY);
    mounted.scope.setters.on(true);
    const button = mounted.q('button')!;
    const span = mounted.q('span')!;
    mounted.scope.setters.on(false);
    expect([m.effects(), m.listeners()]).toEqual([4, 2]);
    mounted.handle.unmount();
    expect([m.effects(), m.listeners()]).toEqual([0, 0]);
    button.click();
    mounted.scope.setters.n(5);
    expect([mounted.scope.getters.n(), span.textContent]).toEqual([5, '0']);
  });
});
