import { compiled, emptyRegistry, installState, useFreshDocument } from './helpers/compiled-island.js';
import { trustedHtml } from '../trusted-html';
/**
 * Fragments in adoption (FORMA-003, decision brief DR-7 (a)).
 *
 * A JSX Fragment has no element of its own: the server renders its children in
 * place. Before this fix `h(Fragment)` built a detached DocumentFragment even
 * while hydrating, and hydrateIsland treated that non-descriptor as success:
 * it removed data-forma-ssr, adopted nothing, and the page stayed inert. These
 * tests adopt Fragments under a caller-owned root, at an island root, nested inside an
 * element and as a show branch, and pin that a value adoption cannot match is
 * a failure, not a silent success.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createEffect, createSignal, onError } from 'forma/reactive';
import { h, Fragment, fragment } from '../element';
import { adoptInRoot } from './helpers/owned-adoption.js';
import { activateIslands, deactivateAllIslands } from '../activate';
import { createShow } from '../show';
import { createList } from '../list';
import { hydrateIsland } from '../hydrate';
import { templateMany } from '../template';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Server HTML for the verification run 1 page: a root Fragment. */
function serverPage(): HTMLElement {
  document.body.innerHTML =
    '<div id="app" data-forma-ssr><span id="note"><!--f:t0-->hello<!--/f:t0--></span><button id="go">go</button></div>';
  return document.getElementById('app')!;
}

describe('Fragment adoption', () => {
  it('a root Fragment binds its click handler and reactive text under a caller-owned adoption root', () => {
    const app = serverPage();
    const span = document.getElementById('note')!;
    const button = document.getElementById('go')!;
    const [note, setNote] = createSignal('hello');

    const dispose = adoptInRoot(() => h(Fragment, null,
      h('span', { id: 'note' }, () => note()),
      h('button', { id: 'go', onClick: () => setNote('bye') }, 'go'),
    ), app);

    // Adopted in place: the server's nodes, not new ones.
    expect(document.getElementById('note')).toBe(span);
    expect(document.getElementById('go')).toBe(button);
    expect(app.hasAttribute('data-forma-ssr')).toBe(true);
    expect(span.textContent).toBe('hello');

    button.click();
    expect(span.textContent).toBe('bye');
    setNote('again');
    expect(span.textContent).toBe('again');
    button.click();
    expect(span.textContent).toBe('bye');
    expect(app.querySelectorAll('span')).toHaveLength(1);

    dispose();
  });

  it('the fragment() helper is adopted like a JSX Fragment', () => {
    const app = serverPage();
    const span = document.getElementById('note')!;
    const [note, setNote] = createSignal('hello');

    adoptInRoot(() => fragment(
      h('span', { id: 'note' }, () => note()),
      h('button', { id: 'go', onClick: () => setNote('bye') }, 'go'),
    ), app);

    document.getElementById('go')!.click();
    expect(span.textContent).toBe('bye');
    expect(app.childNodes).toHaveLength(2);
  });

  it('compiled island Fragment roots refuse while the public facade adopts independent ranges', async () => {
    document.body.innerHTML = [0, 1].map((id) =>
      `<div data-forma-island="${id}" data-forma-component="Pair">` +
      `<span class="n"><!--f:t0-->${id}<!--/f:t0--></span><button class="inc">+</button></div>`,
    ).join('');
    installState([{ id: 0 }, { id: 1 }]);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = Array.from(document.querySelectorAll('span, button'));
    await activateIslands({
      Pair: compiled((props: { id: number }) => {
        const [n, setN] = createSignal(props.id);
        return h(Fragment, null,
          h('span', { class: 'n' }, () => String(n())),
          h('button', { class: 'inc', onClick: () => setN(n() + 10) }, '+'),
        );
      }, [[{ name: 'id', type: { kind: 'number' } }]]),
    });

    const islands = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    const text = () => islands.map((i) => i.querySelector('.n')!.textContent);
    expect(islands.map((i) => i.getAttribute('data-forma-status'))).toEqual(['error', 'error']);
    expect(text()).toEqual(['0', '1']);

    islands[0]!.querySelector<HTMLButtonElement>('.inc')!.click();
    expect(text()).toEqual(['0', '1']);
    expect(Array.from(document.querySelectorAll('span, button'))).toEqual(server);
    // The first Fragment child cannot match the compiled island's owned div host.
    expect(error.mock.calls.filter(call => String(call[0]).includes('FORMA_E_HYDRATE_NODE'))).toHaveLength(2);
    // Separate caller-owned, unmarked containers exercise the public range API.
    // The refused compiled hosts retain their claims, status and original nodes.
    const publicRoot = document.createElement('section');
    publicRoot.innerHTML = [0, 1].map(id => `<div><span class="n"><!--f:t0-->${id}<!--/f:t0--></span><button class="inc">+</button></div>`).join('');
    document.body.append(publicRoot);
    const ranges = Array.from(publicRoot.children);
    const rangeNodes = Array.from(publicRoot.querySelectorAll('span, button'));
    for (const [id, container] of ranges.entries()) {
      adoptInRoot(() => {
        const [n, setN] = createSignal(id);
        return h(Fragment, null, h('span', { class: 'n' }, () => String(n())),
          h('button', { class: 'inc', onClick: () => setN(n() + 10) }, '+'));
      }, container);
    }
    const rangeText = () => ranges.map(container => container.querySelector('.n')!.textContent);
    ranges[0]!.querySelector<HTMLButtonElement>('.inc')!.click();
    expect(rangeText()).toEqual(['10', '1']);
    ranges[1]!.querySelector<HTMLButtonElement>('.inc')!.click();
    expect(rangeText()).toEqual(['10', '11']);
    ranges[0]!.querySelector<HTMLButtonElement>('.inc')!.click();
    expect(rangeText()).toEqual(['20', '11']);
    expect(Array.from(publicRoot.querySelectorAll('span, button'))).toEqual(rangeNodes);
    expect(text()).toEqual(['0', '1']);
    expect(islands.map((i) => i.querySelectorAll('span').length)).toEqual([1, 1]);
  });

  it('a nested Fragment is adopted in place and the siblings after it stay aligned', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><section><b>a</b><!--f:t0-->x<!--/f:t0--><i>c</i><button><!--f:t1-->go 0<!--/f:t1--></button></section></div>';
    const app = document.getElementById('app')!;
    const section = app.querySelector('section')!;
    const bold = section.querySelector('b')!;
    const button = section.querySelector('button')!;
    const [label, setLabel] = createSignal('x');
    const [clicks, setClicks] = createSignal(0);

    adoptInRoot(() => h('section', null,
      h(Fragment, null,
        h('b', { onClick: () => setLabel('from b') }, 'a'),
        () => label(),
        h(Fragment, null, h('i', null, 'c')),
      ),
      h('button', { onClick: () => setClicks(clicks() + 1) }, () => `go ${clicks()}`),
    ), app);

    // The button after the Fragment is still the server's, and bound.
    expect(section.querySelector('button')).toBe(button);
    button.click();
    expect(button.textContent).toBe('go 1');
    bold.click();
    expect(section.textContent).toBe('afrom bcgo 1');
    setLabel('y');
    expect(section.textContent).toBe('aycgo 1');
    expect(section.children).toHaveLength(3);
  });

  it('a Fragment branch of createShow is adopted between the show markers', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><div><!--f:s0--><span>one</span><button>off</button><!--/f:s0--></div></div>';
    const app = document.getElementById('app')!;
    const serverButton = app.querySelector('button')!;
    const [open, setOpen] = createSignal(true);

    adoptInRoot(() => h('div', null,
      createShow(open,
        () => h(Fragment, null, h('span', null, 'one'), h('button', { onClick: () => setOpen(false) }, 'off')),
        () => h('em', null, 'closed'),
      ),
    ), app);

    serverButton.click();
    expect(app.querySelector('em')?.textContent).toBe('closed');
    expect(app.querySelector('span')).toBeNull();
    setOpen(true);
    expect(app.querySelector('span')?.textContent).toBe('one');
    app.querySelector('button')!.click();
    expect(app.querySelector('em')?.textContent).toBe('closed');
  });

  it('a tag mismatch refuses a Fragment child with zero writes and preserves the server subtree', () => {
    document.body.innerHTML = '<div id="app" data-forma-ssr><p>stale</p></div>';
    const app = document.getElementById('app')!;
    const p = app.firstChild;
    const before = app.innerHTML;
    const [count, setCount] = createSignal(0);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observer = new MutationObserver(() => {});
    observer.observe(app, { subtree: true, childList: true, attributes: true, characterData: true });
    adoptInRoot(() => h('section', null,
      h(Fragment, null, h('button', { onClick: () => setCount(count() + 1) }, () => `n=${count()}`))), app);
    expect(observer.takeRecords()).toEqual([]); observer.disconnect();
    expect(error.mock.calls[0]?.[0]).toContain('FORMA_E_HYDRATE_NODE');
    expect(app.innerHTML).toBe(before);
    expect(app.firstChild).toBe(p);
    expect(app.querySelector('button')).toBeNull();
    setCount(1);
    expect(app.innerHTML).toBe(before);
  });

  it('an imperative island returning its own element refuses without running its deferred effect', async () => {
    // 2.0.1's imperative pattern: wire the server DOM by hand, return `el`.
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Imp"><button>0</button></div>' +
      '<div data-forma-island="1" data-forma-component="Imp"><button>0</button></div>';
    installState([{ id: 0 }, { id: 1 }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalButtons = Array.from(document.querySelectorAll('button'));
    let runs = 0;
    await activateIslands({
      Imp: compiled((props: { id: number }) => {
        const el = document.querySelector<HTMLElement>(`[data-forma-island="${props.id}"]`)!;
        const [n, setN] = createSignal(0);
        const button = el.querySelector('button')!;
        button.addEventListener('click', () => setN(n() + 1));
        createEffect(() => { runs++; button.textContent = String(n()); });
        return el;
      }, [[{ name: 'id', type: { kind: 'number' } }]]),
    });

    const islands = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    const buttons = islands.map((i) => i.querySelector('button')!);
    expect(islands.map((i) => i.getAttribute('data-forma-status'))).toEqual(['error', 'error']);
    expect(buttons).toEqual(originalButtons);
    expect(error.mock.calls.filter(call => String(call[0]).includes('FORMA_E_HYDRATE_STRUCTURE'))).toHaveLength(2);
    buttons[0]!.click();
    buttons[0]!.click();
    buttons[1]!.click();
    buttons[0]!.click();
    // The component's manual addEventListener is outside managed APIs; no effect may run.
    expect(runs).toBe(0);
    expect(buttons.map((b) => b.textContent)).toEqual(['0', '0']);
  });

  it('an island that returns a detached DOM node is marked error with its code, its sibling unaffected', async () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Bad"><span>x</span></div>' +
      '<div data-forma-island="1" data-forma-component="Good"><span>y</span></div>';
    installState();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await activateIslands(emptyRegistry({
      Bad: () => document.createElement('span'),
      Good: () => h('div', null, h('span', null, 'y')),
    }));
    const logged = error.mock.calls.map((call) => String(call[0]));
    error.mockRestore();

    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual(['error', null]);
    expect(logged.filter((line) => line.includes('FORMA_E_HYDRATE_STRUCTURE') && line.includes('"Bad"'))).toHaveLength(1);
    expect(document.querySelector('[data-forma-island="0"]')!.innerHTML).toBe('<span>x</span>');
  });

  it('an imperative append-and-return fragment is refused and its deferred effect never runs', async () => {
    // Preserve the archived imperative input: returning its emptied fragment
    // is now a strict refusal, and deferred effects never acquire ownership.
    document.body.innerHTML = [0, 1].map((id) =>
      `<div data-forma-island="${id}" data-forma-component="Many"><p>server ${id}</p></div>`).join('');
    installState([{ id: 0 }, { id: 1 }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalParagraphs = Array.from(document.querySelectorAll('p'));
    let runs = 0;
    const setters: Array<(v: number) => void> = [];
    await activateIslands({
      Many: compiled((props: { id: number }) => {
        const el = document.querySelector<HTMLElement>(`[data-forma-island="${props.id}"]`)!;
        const fragment = templateMany(trustedHtml('<button>0</button><i>tail</i>'));
        el.append(fragment);
        const [n, setN] = createSignal(0);
        setters.push(setN);
        const button = el.querySelector('button')!;
        createEffect(() => { runs++; button.textContent = String(n()); });
        return fragment;
      }, [[{ name: 'id', type: { kind: 'number' } }]]),
    });

    const islands = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    expect(islands.map((i) => i.getAttribute('data-forma-status'))).toEqual(['error', 'error']);
    setters[0]!(5);
    setters[1]!(7);
    setters[0]!(6);
    // Imperative append is an attempted component side effect, not successful adoption.
    // The strict planner refuses; it does not bless those appended nodes or run effects.
    expect(error.mock.calls.filter(call => String(call[0]).includes('FORMA_E_HYDRATE_STRUCTURE'))).toHaveLength(2);
    expect(runs).toBe(0);
    expect(Array.from(document.querySelectorAll('p'))).toEqual(originalParagraphs);
    expect(islands.map((i) => i.querySelector('button')!.textContent)).toEqual(['0', '0']);
    expect(islands[0]!.textContent).toBe('server 00tail');
  });

  it('onError receives FORMA_E_HYDRATE_STRUCTURE from activateIslands, caller-owned adoption and hydrateIsland()', async () => {
    const received: Array<[string, string | undefined]> = [];
    const off = onError((err, info) => {
      received.push([String((err as { code?: unknown }).code), info?.source]);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      document.body.innerHTML =
        '<div data-forma-island="0" data-forma-component="Detached"><span>x</span></div>' +
        '<div id="app" data-forma-ssr><p>m</p></div><div id="direct" data-forma-ssr><p>d</p></div>';
      installState();
      await activateIslands(emptyRegistry({ Detached: () => document.createElement('span') }));
      adoptInRoot(() => document.createElement('p') as unknown as HTMLElement, '#app');
      hydrateIsland(() => document.createElement('p'), document.getElementById('direct')!);
    } finally {
      error.mockRestore();
      off();
    }

    expect(received).toEqual([
      ['FORMA_E_HYDRATE_STRUCTURE', 'hydration'],
      ['FORMA_E_HYDRATE_STRUCTURE', 'hydration'],
      ['FORMA_E_HYDRATE_STRUCTURE', 'hydration'],
    ]);
    // A working island reports nothing.
    const nextDocument = document.implementation.createHTMLDocument('positive sibling control');
    nextDocument.body.innerHTML = '<div data-forma-island="0" data-forma-component="Fine"><b>ok</b></div>';
    installState(undefined, nextDocument);
    const off2 = onError((err) => received.push([String(err), 'unexpected']));
    await activateIslands(emptyRegistry({ Fine: () => h('div', null, h('b', null, 'ok')) }), nextDocument);
    expect(nextDocument.querySelector('[data-forma-island]')!.getAttribute('data-forma-status')).toBeNull();
    deactivateAllIslands(nextDocument);
    off2();
    expect(received).toHaveLength(3);
  });

  it('caller-owned direct adoption logs a detached-node refusal and stops effects when its caller disposes', () => {
    const app = serverPage();
    const before = app.innerHTML;
    const [n, setN] = createSignal(0);
    let runs = 0;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    let dispose: (() => void) | undefined;
    expect(() => {
      dispose = adoptInRoot(() => {
        createEffect(() => { n(); runs++; });
        return document.createElement('p') as unknown as HTMLElement;
      }, app);
    }).not.toThrow();
    const logged = error.mock.calls.map((call) => String(call[0]));
    error.mockRestore();

    expect(typeof dispose).toBe('function');
    expect(app.hasAttribute('data-forma-ssr')).toBe(true);
    expect(app.innerHTML).toBe(before);
    expect(logged.filter((line) => line.includes('FORMA_E_HYDRATE_STRUCTURE'))).toHaveLength(1);
    // Validation refuses before deferred effects; the caller still owns its root.
    expect(runs).toBe(0);
    dispose!();
    setN(1);
    setN(2);
    expect(runs).toBe(0);
    dispose!();
    expect(app.innerHTML).toBe(before);
  });

  it('hydrateIsland called directly with a detached node logs the code and keeps the server DOM', () => {
    const app = serverPage();
    const before = app.innerHTML;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = hydrateIsland(() => document.createElement('span'), app);
    const logged = error.mock.calls.map((call) => String(call[0]));
    error.mockRestore();

    expect(result).toBe(app);
    expect(app.hasAttribute('data-forma-ssr')).toBe(true);
    expect(app.innerHTML).toBe(before);
    expect(logged.filter((line) => line.includes('FORMA_E_HYDRATE_STRUCTURE'))).toHaveLength(1);
  });

  it("a root createShow or createList is adopted against the container's children", () => {
    document.body.innerHTML =
      '<div id="show" data-forma-ssr><!--f:s0--><button id="toggle">on</button><!--/f:s0--></div>' +
      '<ul id="list" data-forma-ssr><!--f:l0--><li data-forma-key="a">a</li><li data-forma-key="b">b</li><!--/f:l0--></ul>';
    const toggleButton = document.getElementById('toggle')!;
    const [on, setOn] = createSignal(true);
    const [items, setItems] = createSignal(['a', 'b']);
    const clicked: string[] = [];

    adoptInRoot(() => createShow(on,
      () => h('button', { id: 'toggle', onClick: () => setOn(false) }, 'on'),
      () => h('em', null, 'off'),
    ) as unknown as HTMLElement, '#show');
    adoptInRoot(() => createList(items, (x) => x, (x) => h('li', { onClick: () => clicked.push(x) }, x)) as unknown as HTMLElement, '#list');

    // The server's nodes are bound, not replaced.
    toggleButton.click();
    expect(document.getElementById('show')!.textContent).toBe('off');
    setOn(true);
    expect(document.getElementById('toggle')!.textContent).toBe('on');
    const serverRows = Array.from(document.querySelectorAll('#list li'));
    (serverRows[1] as HTMLElement).click();
    expect(clicked).toEqual(['b']);
    setItems(['b', 'c']);
    expect(Array.from(document.querySelectorAll('#list li'), (li) => li.textContent)).toEqual(['b', 'c']);
    expect(document.querySelector('#list li')).toBe(serverRows[1]);
  });

  it('an imperative component that writes then returns nothing is refused, never marked active', async () => {
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="Imperative"><b>0</b></div>';
    installState();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = document.querySelector('b');
    await activateIslands(emptyRegistry({
      Imperative: () => {
        const el = document.querySelector<HTMLElement>('[data-forma-component="Imperative"]')!;
        el.querySelector('b')!.textContent = 'set by the island';
        return undefined;
      },
    }));
    const island = document.querySelector('[data-forma-island]')!;
    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(error.mock.calls[0]?.[0]).toContain('FORMA_E_HYDRATE_STRUCTURE');
    expect(island.querySelector('b')).toBe(original);
    expect(island.textContent).toBe('set by the island');
  });
});

useFreshDocument();
