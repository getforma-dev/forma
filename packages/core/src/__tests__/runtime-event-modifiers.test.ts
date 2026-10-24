import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * Event modifiers borrowed from other frameworks (FORMA-269).
 *
 * Vue and Alpine write `@click.stop`, `@submit.prevent`, `@keydown.enter`;
 * model-generated markup carries that syntax over to `data-on:`. The runtime
 * took the whole suffix as the event's name and listened for an event called
 * `click.stop`, which no browser dispatches, and said nothing: the handler was
 * silently dead. Forma has no modifiers, so such a name is refused with
 * a coded diagnostic and binds nothing. A dotted name that is not modifier
 * syntax is a custom event (Bootstrap's `shown.bs.modal`, a
 * `$dispatch('item.selected')`) and binds as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearDiagnostics, getDiagnostics } from '../runtime';

let root: HTMLElement;
let errors: string[];

beforeEach(() => {
  clearDiagnostics();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  unmountFixture(root);
  root.remove();
  clearDiagnostics();
  vi.restoreAllMocks();
});

/** Mount `body` under a scope holding `{"n":0}`, with `#out` showing `n`. */
function mount(body: string): void {
  root.innerHTML = `<div data-forma-state='{"n":0}'>${body}<span id="out" data-text="{n}"></span></div>`;
  mountFixture(root);
}

const out = (): string => root.querySelector('#out')!.textContent!;
const fire = (sel: string, type: string): void => {
  root.querySelector(sel)!.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
};

describe('data-on: event modifiers', () => {
  it('data-on:click.stop is refused with a coded diagnostic that names the attribute, and binds no listener', () => {
    mount('<button id="b" data-on:click.stop="{n++}">go</button>');

    expect(getDiagnostics().map(d => [d.kind, d.code, d.expr])).toEqual([
      ['handler-unsupported', 'FORMA_E_UNSUPPORTED', 'data-on:click.stop="{n++}"'],
    ]);
    const reason = getDiagnostics()[0]!.reason;
    expect(reason).toBe('event modifiers are not supported: use data-on:click and '
      + '$event.stopPropagation(), $event.preventDefault() or $event.key in the handler');
    expect(root.querySelector('#b')!.getAttribute('data-forma-handler-error')).toBe('unsupported');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('FORMA_E_UNSUPPORTED');
    expect(errors[0]).toContain('data-on:click.stop');

    // Nothing listens: not for the base event, and not for the literal name.
    fire('#b', 'click');
    fire('#b', 'click.stop');
    expect(out()).toBe('0');
  });

  it.each([
    'click.prevent', 'submit.prevent', 'click.once', 'click.self', 'click.capture',
    'touchstart.passive', 'click.native', 'click.outside', 'click.away', 'scroll.window',
    'keyup.document', 'input.debounce', 'input.debounce.300ms', 'click.throttle.500ms',
    'click.exact', 'click.ctrl', 'click.alt', 'click.shift', 'click.meta', 'click.cmd',
    'click.left', 'click.right', 'click.middle', 'click.stop.prevent',
    'keydown.enter', 'keyup.escape', 'keyup.esc', 'keydown.space', 'keydown.tab',
    'keydown.arrow-down', 'keydown.ctrl.enter', 'keypress.a', 'keydown.window.escape',
  ])('data-on:%s is refused and binds nothing', (event) => {
    mount(`<button id="b" data-on:${event}="{n++}">go</button>`);
    const base = event.slice(0, event.indexOf('.'));

    expect(getDiagnostics().map(d => [d.kind, d.code, d.expr])).toEqual([
      ['handler-unsupported', 'FORMA_E_UNSUPPORTED', `data-on:${event}="{n++}"`],
    ]);
    expect(getDiagnostics()[0]!.reason).toContain(`use data-on:${base} `);
    expect(root.querySelector('#b')!.getAttribute('data-forma-handler-error')).toBe('unsupported');
    fire('#b', base);
    fire('#b', event);
    expect(out()).toBe('0');
  });

  it('plain event names and dotted custom events bind as before, with no diagnostic', () => {
    const names = [
      'click', 'keydown', 'submit', 'forma:interval', 'cart-updated',
      'item.selected', 'shown.bs.modal', 'close.bs.alert', 'todo.delete', 'menu.up', 'stop.now',
      // A modifier word is matched whole: a longer suffix is not that word.
      'timer.stopped', 'item.selfie', 'panel.leftover', 'tab.once-more',
      // Only the first suffix is checked: a modifier word after it is a name.
      'carousel.slide.left', 'menu.item.stop',
    ];
    mount(names.map((name, i) => `<button id="b${i}" data-on:${name}="{n++}">x</button>`).join('')
      + `<div data-on:item.selected="{n = n + 100}"><button id="send" data-on:click="{$dispatch('item.selected')}">send</button></div>`);

    names.forEach((name, i) => fire(`#b${i}`, name));
    expect(out()).toBe(String(names.length));
    // A $dispatch of a dotted name reaches a data-on: of that name above it.
    fire('#send', 'click');
    expect(out()).toBe(String(names.length + 100));
    expect(getDiagnostics()).toEqual([]);
    expect(root.querySelectorAll('[data-forma-handler-error]')).toHaveLength(0);
  });

  it('a custom event named with a modifier after its first dot is refused too', () => {
    // The check is by name, so it is conservative: `timer.stop` reads as
    // `timer` with `.stop`. Rename it (`timer-stop`).
    mount('<button id="b" data-on:timer.stop="{n++}">x</button><button id="c" data-on:timer-stop="{n++}">y</button>');

    expect(getDiagnostics().map(d => d.expr)).toEqual(['data-on:timer.stop="{n++}"']);
    fire('#b', 'timer.stop');
    expect(out()).toBe('0');
    fire('#c', 'timer-stop');
    expect(out()).toBe('1');
  });

  it('modifier syntax the check does not recognise is not detected: it listens for its literal name, with no diagnostic', () => {
    // Still dead handlers, a known gap stated in docs/HTML-RUNTIME.md and
    // SECURITY.md: a first suffix not in the list, an empty one, Alpine's
    // `.camel` and `.dot`, and Datastar's `__` syntax. (Svelte's `|` is
    // e2e/event-modifiers.spec.ts's, in Chromium.)
    const names = [
      'click.foo', 'click.foo.stop', 'click.', 'click..stop',
      'custom-event.camel', 'custom-event.dot', 'click__prevent', 'keydown__window',
    ];
    mount(names.map((name, i) => `<button id="b${i}" data-on:${name}="{n++}">x</button>`).join(''));

    names.forEach((name, i) => fire(`#b${i}`, name.split(/\.|__/)[0]!));
    expect(out()).toBe('0');
    names.forEach((name, i) => fire(`#b${i}`, name));
    expect(out()).toBe(String(names.length));
    expect(getDiagnostics()).toEqual([]);
  });

  it('a refused .prevent prevents nothing: the default still happens, as before FORMA-269', () => {
    // Refusing the name does not perform the modifier. What is new is the
    // diagnostic. e2e/event-modifiers.spec.ts shows the form submitting in Chromium.
    mount('<form id="f" data-on:submit.prevent="{n++}"><button>go</button></form><a id="a" href="#x" data-on:click.prevent="{n++}">a</a>');

    const submit = new Event('submit', { bubbles: true, cancelable: true });
    root.querySelector('#f')!.dispatchEvent(submit);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    root.querySelector('#a')!.dispatchEvent(click);
    expect([submit.defaultPrevented, click.defaultPrevented]).toEqual([false, false]);
    expect(out()).toBe('0');
    expect(getDiagnostics().map(d => d.code)).toEqual(['FORMA_E_UNSUPPORTED', 'FORMA_E_UNSUPPORTED']);
  });

  it("the refusal costs that handler only: the element's other directives bind", () => {
    mount('<button id="b" data-on:click.stop="{n++}" data-on:mouseover="{n = n + 10}" data-bind:title="{`t${n}`}">go</button>');

    fire('#b', 'mouseover');
    expect(out()).toBe('10');
    expect(root.querySelector('#b')!.getAttribute('title')).toBe('t10');
    expect(root.querySelector('#b')!.getAttribute('data-forma-handler-error')).toBe('unsupported');
    expect(getDiagnostics()).toHaveLength(1);
  });

  it('the explicit form the diagnostic names works: $event.stopPropagation(), $event.preventDefault() and $event.key', () => {
    mount(`
      <div id="outer" data-on:click="{n = n + 100}">
        <button id="inner" data-on:click="{$event.stopPropagation(); n++}">in</button>
      </div>
      <a id="link" href="#away" data-on:click="{$event.preventDefault()}">link</a>
      <input id="field" data-on:keydown="{if ($event.key === 'Enter') { n = n + 10 }}">
    `);

    fire('#inner', 'click');
    expect(out()).toBe('1');
    fire('#outer', 'click');
    expect(out()).toBe('101');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    root.querySelector('#link')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    root.querySelector('#field')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(out()).toBe('101');
    root.querySelector('#field')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(out()).toBe('111');
    expect(getDiagnostics()).toEqual([]);
  });

  it('every row of the rewrite table in docs/HTML-RUNTIME.md: the modifier form is refused and the rewrite runs', () => {
    const doc = readFileSync(resolve(process.cwd(), 'docs/HTML-RUNTIME.md'), 'utf8');
    const lines = doc.slice(doc.indexOf('| Instead of | Write |')).split('\n').slice(2);
    const rows = lines.slice(0, lines.findIndex(l => !l.startsWith('|')))
      .map(l => l.split('|').slice(1, -1).map(c => c.trim().replace(/^`|`$/g, '')));
    expect(rows.map(([before]) => before!.slice(0, before!.indexOf('='))))
      .toEqual(['data-on:click.stop', 'data-on:submit.prevent', 'data-on:keydown.enter']);

    const STATE = `<div data-forma-state='{"open":true,"sent":false,"count":0}'>`;
    const SHOW = '<span id="state" data-text="{`${open} ${sent} ${count}`}"></span>';
    for (const [before, after] of rows) {
      const event = after!.slice(8, after!.indexOf('='));
      const trigger = (): Event => event === 'keydown'
        ? new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        : new Event(event, { bubbles: true, cancelable: true });

      root.innerHTML = `${STATE}<button id="b" ${before}>x</button>${SHOW}</div>`;
      mountFixture(root);
      expect(getDiagnostics().map(d => [d.code, d.expr])).toEqual([['FORMA_E_UNSUPPORTED', before]]);
      root.querySelector('#b')!.dispatchEvent(trigger());
      expect(root.querySelector('#state')!.textContent).toBe('true false 0');

      clearDiagnostics();
      root.innerHTML = `${STATE}<button id="b" ${after}>x</button>${SHOW}</div>`;
      mountFixture(root);
      const fired = trigger();
      root.querySelector('#b')!.dispatchEvent(fired);
      expect(root.querySelector('#state')!.textContent).not.toBe('true false 0');
      expect(fired.defaultPrevented).toBe(event === 'submit');
      expect(getDiagnostics()).toEqual([]);
      clearDiagnostics();
    }
  });
});
