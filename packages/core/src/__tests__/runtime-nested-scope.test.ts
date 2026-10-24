/**
 * FORMA-283: a `data-forma-state` scope nested in another.
 *
 * mountScope binds every directive element under its root, and its walk
 * stopped only at the root of a nested mountMarkup. So a scope also bound the
 * elements of a `data-forma-state` scope nested in it, against its own state:
 * a name only the inner scope declares was reported FORMA_E_UNRESOLVED, a
 * write to the outer state overwrote the inner scope's text, and a click ran
 * the inner handler and the outer one. Scopes do not inherit from each other:
 * each binds its own elements, its root's own directives included, against
 * its own state, and the outer one binds none of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountHandle, MountOptions } from '../runtime';

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
  document.body.replaceChildren();
});

type Scope = { getters: Record<string, () => unknown>; setters: Record<string, (v: unknown) => void> };

function mount(markup: string, root?: HTMLElement, options: MountOptions = { tier: 'reviewed' }): { root: HTMLElement; handle: MountHandle } {
  if (!root) {
    root = document.createElement('div');
    document.body.append(root);
  }
  const handle = runtime.mountMarkup(root, runtime.trustedHtml(markup), options);
  handles.push(handle);
  return { root, handle };
}

function update(handle: MountHandle, markup: string): void {
  handle.update(runtime.trustedHtml(markup));
}

const $ = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
const text = (selector: string): string | null => document.querySelector(selector)?.textContent ?? null;
const texts = (selector: string): string[] => [...document.querySelectorAll(selector)].map((el) => el.textContent ?? '');
const scope = (selector: string): Scope => ($(selector) as unknown as { __formaScope: Scope }).__formaScope;
const codes = (): string[] => runtime.getDiagnostics().map((d) => `${d.code} ${d.expr}`);

/** The ticket's markup, with an outer `n` of its own to see whether the outer handler ran. */
const TICKET = `<section id="o" data-forma-state='{"msg":"outer","n":100}'>`
  + `<article id="i" data-forma-state='{"msg":"inner","only":"io","n":0}'>`
  + '<span id="t" data-text="{msg}"></span><i id="only" data-text="{only}"></i>'
  + '<button id="b" data-on:click="{n++}">b</button><b id="n" data-text="{n}"></b></article></section>';

it('the ticket markup: the inner scope binds its elements once, and the outer scope binds none of them', () => {
  mount(TICKET);
  expect(codes()).toEqual([]);
  expect([text('#t'), text('#only'), text('#n')]).toEqual(['inner', 'io', '0']);
  scope('#o').setters.msg('outer2');
  expect(text('#t')).toBe('inner');
  scope('#i').setters.msg('inner2');
  expect(text('#t')).toBe('inner2');
  $('#b').click();
  expect([scope('#i').getters.n(), scope('#o').getters.n(), text('#n')]).toEqual([1, 100, '1']);
  expect(codes()).toEqual([]);
});

it('the outer scope binds its own elements before and after a nested scope, and they follow its state only', () => {
  mount(`<section id="o" data-forma-state='{"msg":"outer","n":100}'>`
    + '<p id="before" data-text="{msg}"></p><button id="ob" data-on:click="{n++}">o</button>'
    + `<article id="i" data-forma-state='{"msg":"inner","n":0}'><span id="t" data-text="{msg}"></span></article>`
    + '<p id="after" data-text="{msg}"></p><output id="on" data-text="{n}"></output></section>');
  expect([text('#before'), text('#t'), text('#after')]).toEqual(['outer', 'inner', 'outer']);
  scope('#o').setters.msg('outer2');
  expect([text('#before'), text('#t'), text('#after')]).toEqual(['outer2', 'inner', 'outer2']);
  $('#ob').click();
  expect([scope('#o').getters.n(), scope('#i').getters.n(), text('#on')]).toEqual([101, 0, '101']);
  expect(codes()).toEqual([]);
});

it('scopes do not inherit: a name only the outer state declares is unresolved in the inner scope, and the outer scope does not render it there', () => {
  mount(`<section data-forma-state='{"theme":"night"}'><p id="o" data-text="{theme}"></p>`
    + `<article data-forma-state='{}'><span id="t" data-text="{theme}">markup</span></article></section>`);
  expect([text('#o'), text('#t')]).toEqual(['night', 'markup']);
  expect(codes()).toEqual(['FORMA_E_UNRESOLVED theme']);
});

it("a nested scope root's own directives are its scope's, bound once", () => {
  mount(`<section id="o" data-forma-state='{"tag":"out","n":100,"hot":true}'>`
    + `<article id="i" data-forma-state='{"tag":"in","n":0,"hot":false}' data-bind:title="{tag}" data-class:hot="{hot}"`
    + ' data-on:click="{n++}" data-text="{tag + n}"></article></section>');
  const article = $('#i');
  expect([article.title, article.className, article.textContent]).toEqual(['in', '', 'in0']);
  scope('#o').setters.tag('out2');
  scope('#o').setters.hot(true);
  expect([article.title, article.className]).toEqual(['in', '']);
  article.click();
  expect([scope('#i').getters.n(), scope('#o').getters.n(), article.textContent]).toEqual([1, 100, 'in1']);
  expect(codes()).toEqual([]);
});

it("a nested scope root's own data-if follows its own state, not the outer scope's", () => {
  mount(`<section id="o" data-forma-state='{"open":false}'>`
    + `<article id="i" data-forma-state='{"open":true,"msg":"inner"}' data-if="{open}"><span id="t" data-text="{msg}">stale</span>`
    + '<button id="close" data-on:click="{open = false}">x</button></article></section>');
  expect(text('#t')).toBe('inner');
  const inner = scope('#i');
  scope('#o').setters.open(true);
  scope('#o').setters.open(false);
  expect(text('#t')).toBe('inner');
  $('#close').click();
  expect(document.getElementById('i')).toBeNull();
  scope('#o').setters.open(true);
  expect(document.getElementById('i')).toBeNull();
  inner.setters.open(true);
  inner.setters.msg('again');
  expect(text('#t')).toBe('again');
  expect(codes()).toEqual([]);
});

it("$refs: each scope's names are its own elements, and the outer scope does not reach the inner scope's", () => {
  mount(`<section data-forma-state='{}'><i data-ref="r" id="outer-r"></i>`
    + `<article data-forma-state='{}'><i data-ref="r" id="inner-r"></i><i data-ref="mine" id="inner-only"></i>`
    + '<b id="inner-read" data-text="{$refs.r.id}"></b><b id="inner-mine" data-text="{$refs.mine.id}"></b></article>'
    + `<b id="outer-read" data-text="{$refs.r.id}"></b><b id="outer-miss" data-text="{$refs.mine ? 'reached' : 'none'}"></b></section>`);
  expect([text('#outer-read'), text('#outer-miss'), text('#inner-read'), text('#inner-mine')])
    .toEqual(['outer-r', 'none', 'inner-r', 'inner-only']);
  expect(codes()).toEqual([]);
});

it('three levels: each scope binds its own elements, around the scope nested in it, and only those', () => {
  mount(`<div id="a" data-forma-state='{"msg":"a","n":0}'><p class="a" data-text="{msg}"></p>`
    + `<div id="b" data-forma-state='{"msg":"b","n":0}'><p class="b" data-text="{msg}"></p>`
    + `<div id="c" data-forma-state='{"msg":"c","n":0}'><p class="c" data-text="{msg}"></p><button id="bc" data-on:click="{n++}">c</button></div>`
    + '<p class="b" data-text="{msg}"></p><button id="bb" data-on:click="{n++}">b</button></div>'
    + '<p class="a" data-text="{msg}"></p><button id="ba" data-on:click="{n++}">a</button></div>');
  const seen = (): string[][] => [texts('.a'), texts('.b'), texts('.c')];
  expect(seen()).toEqual([['a', 'a'], ['b', 'b'], ['c']]);
  scope('#a').setters.msg('A');
  expect(seen()).toEqual([['A', 'A'], ['b', 'b'], ['c']]);
  scope('#b').setters.msg('B');
  expect(seen()).toEqual([['A', 'A'], ['B', 'B'], ['c']]);
  scope('#c').setters.msg('C');
  expect(seen()).toEqual([['A', 'A'], ['B', 'B'], ['C']]);
  $('#bc').click();
  $('#bb').click();
  $('#bb').click();
  $('#ba').click();
  $('#ba').click();
  $('#ba').click();
  expect(['#a', '#b', '#c'].map((s) => scope(s).getters.n())).toEqual([3, 2, 1]);
  expect(codes()).toEqual([]);
});

describe.each([false, true])('a scope nested in a data-if that is %s at mount', (start) => {
  it('is bound once, by its own scope, hidden or shown', () => {
    mount(`<section id="o" data-forma-state='{"on":${start},"msg":"outer","n":100}'><div data-if="{on}">`
      + `<article id="i" data-forma-state='{"msg":"inner","n":0}'><span id="t" data-text="{msg}">stale</span>`
      + '<button id="b" data-on:click="{n++}">+</button></article></div></section>');
    const outer = scope('#o');
    outer.setters.on(true);
    expect(text('#t')).toBe('inner');
    outer.setters.msg('outer2');
    expect(text('#t')).toBe('inner');
    $('#b').click();
    outer.setters.on(false);
    outer.setters.on(true);
    $('#b').click();
    expect([scope('#i').getters.n(), outer.getters.n()]).toEqual([2, 100]);
    expect(codes()).toEqual([]);
  });
});

it('a scope nested in a data-list row is bound by the row, as before: rows do not mount a nested scope (unchanged here)', () => {
  // A row binds its clone's elements against the row scope (the list's scope
  // plus `item` and `index`) and mounts no scope in it; FORMA-283 changes
  // only what a mounted scope binds. The outer scope's pass still binds
  // nothing in the row template, and the elements after the list are its own.
  mount(`<section id="o" data-forma-state='{"rows":[{"id":1},{"id":2}],"msg":"outer"}'>`
    + `<ul data-list="{rows}"><li><div data-forma-state='{"msg":"inner"}'><i class="id" data-text="{item.id}"></i>`
    + '<span class="m" data-text="{msg}"></span></div></li></ul><p id="after" data-text="{msg}"></p></section>');
  expect([texts('.id'), texts('.m'), text('#after')]).toEqual([['1', '2'], ['outer', 'outer'], 'outer']);
  scope('#o').setters.rows([{ id: 1 }, { id: 2 }, { id: 3 }]);
  expect(texts('.id')).toEqual(['1', '2', '3']);
  expect(codes()).toEqual([]);
});

it('a scope nested in another inside a nested mountMarkup root is bound once, by its own scope, with that mount', () => {
  // The outer mount may reach outside its root; the inner mount may not. The
  // innermost scope is bound under the inner mount, so its closest() stops at
  // the inner root.
  document.body.innerHTML = '<main id="page"><div id="outer-root"></div></main>';
  mount(`<section id="o" data-forma-state='{"msg":"outer"}'><p id="op" data-text="{msg}"></p><div id="inner-root"></div></section>`,
    $('#outer-root'), { tier: 'reviewed', grants: { dom: true } });
  mount(`<article id="m" data-forma-state='{"msg":"mid","n":0}'><span id="ms" data-text="{msg}"></span>`
    + `<aside id="d" data-forma-state='{"msg":"deep","n":0}'><span id="ds" data-text="{msg}"></span>`
    + `<b id="reach" data-text="{$el.closest('main') ? 'reached' : 'confined'}"></b><button id="db" data-on:click="{n++}">d</button></aside>`
    + '<button id="mb" data-on:click="{n++}">m</button></article>', $('#inner-root'));
  expect([text('#op'), text('#ms'), text('#ds'), text('#reach')]).toEqual(['outer', 'mid', 'deep', 'confined']);
  scope('#o').setters.msg('outer2');
  scope('#m').setters.msg('mid2');
  expect([text('#op'), text('#ms'), text('#ds')]).toEqual(['outer2', 'mid2', 'deep']);
  $('#db').click();
  expect([scope('#m').getters.n(), scope('#d').getters.n()]).toEqual([0, 1]);
  expect(codes()).toEqual([]);
});

describe('bindings, counted', () => {
  /** Live internal effects, and live listeners on elements. */
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
    return (): number[] => [effects.size, listeners];
  }

  const INNER = `<article data-forma-state='{"msg":"inner","n":0,"v":""}'><span id="t" data-text="{msg}"></span>`
    + '<button id="b" data-on:click="{n++}">i</button><input data-model="{v}"></article>';
  /** The outer scope, with `slot` between its own elements; `attrs` and `state` vary it for update(). */
  const outer = (slot: string, attrs = '', state = '"msg":"outer","n":100'): string =>
    `<section id="o"${attrs} data-forma-state='{${state}}'><p data-text="{msg}"></p><button id="ob" data-on:click="{n++}">o</button>`
    + `${slot}<output data-text="{n}"></output></section>`;

  /** [effects, listeners] of `markup` mounted on its own. */
  function alone(markup: string): number[] {
    const count = meter();
    const { handle } = mount(markup);
    const counted = count();
    handle.unmount();
    vi.restoreAllMocks();
    return counted;
  }

  /** Each binding runs once: one click is one increment of its own scope only. */
  function clicksOnce(): void {
    const before = [scope('#o').getters.n(), scope('article').getters.n()];
    $('#b').click();
    expect([scope('#o').getters.n(), scope('article').getters.n()]).toEqual([before[0], (before[1] as number) + 1]);
    expect(text('#t')).toBe('inner');
  }

  it('mounting a scope nested in another makes exactly the bindings each makes on its own, and unmounting disposes all of them', () => {
    const sum = alone(outer('')).map((n, i) => n + alone(INNER)[i]!);
    const count = meter();
    const { handle } = mount(outer(INNER));
    expect(count()).toEqual(sum);
    clicksOnce();
    handle.unmount();
    expect(count()).toEqual([0, 0]);
    expect(codes()).toEqual([]);
  });

  it.each([false, true])('a scope nested in a data-if that is %s at mount: the bindings each scope makes on its own, none added by 50 toggles, none left after unmounting while hidden', (start) => {
    const state = (on: boolean): string => `"msg":"outer","n":100,"on":${on}`;
    const sum = alone(outer('<div data-if="{on}"></div>', '', state(start))).map((n, i) => n + alone(INNER)[i]!);
    const count = meter();
    const { handle } = mount(outer(`<div data-if="{on}">${INNER}</div>`, '', state(start)));
    expect(count()).toEqual(sum);
    for (let i = 0; i < 50; i++) { scope('#o').setters.on(!start); scope('#o').setters.on(start); }
    scope('#o').setters.on(true);
    expect(count()).toEqual(sum);
    clicksOnce();
    scope('#o').setters.on(false);
    handle.unmount();
    expect(count()).toEqual([0, 0]);
    expect(codes()).toEqual([]);
  });

  it.each([
    ['an update that keeps both scopes', outer(`${INNER}<em>v2</em>`)],
    ["an update that changes the outer scope's state shape", outer(INNER, '', '"msg":"outer","n":100,"extra":1')],
    ["an update that changes the outer scope's data-module", outer(INNER, ' data-module="b"')],
  ])('%s leaves exactly the bindings a fresh mount makes, each bound once', (_name, next) => {
    const fresh = alone(next);
    const count = meter();
    const { handle } = mount(outer(INNER));
    update(handle, next);
    expect(count()).toEqual(fresh);
    clicksOnce();
    scope('#o').setters.msg('outer2');
    expect(text('#t')).toBe('inner');
    handle.unmount();
    expect(count()).toEqual([0, 0]);
    expect(codes()).toEqual([]);
  });

  it('an update that removes the nested scope disposes it, and one that adds it back binds it once', () => {
    // The removed element is not a scope itself: the scope is nested in it.
    const wrapped = outer(`<div class="wrap">${INNER}</div>`);
    const outerOnly = alone(outer(''));
    const both = alone(wrapped);
    const count = meter();
    const { handle } = mount(wrapped);
    update(handle, outer(''));
    expect(count()).toEqual(outerOnly);
    update(handle, wrapped);
    expect(count()).toEqual(both);
    clicksOnce();
    handle.unmount();
    expect(count()).toEqual([0, 0]);
    expect(codes()).toEqual([]);
  });

  it('an update that adds a scope whose data-if starts false mounts the scope in that branch once', () => {
    const added = `<aside id="a2" data-forma-state='{"on":false}'><div data-if="{on}">${INNER}</div></aside>`;
    const both = alone(outer(added));
    const count = meter();
    const { handle } = mount(outer(''));
    update(handle, outer(added));
    expect(count()).toEqual(both);
    scope('#a2').setters.on(true);
    clicksOnce();
    handle.unmount();
    expect(count()).toEqual([0, 0]);
    expect(codes()).toEqual([]);
  });
});
