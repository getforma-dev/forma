import { emptyRegistry, installState, useFreshDocument } from './helpers/compiled-island.js';
/**
 * The row-count check at list adoption (FORMA-123, decision brief DR-8).
 *
 * Rows without `data-forma-key` are matched by index. Before this check, a
 * client array shorter than the server's rows had the extra rows removed, and
 * one longer had rows rendered fresh, both silently: ksx's #5 lost the server
 * rows absent from a list's array before its state was seeded. Until keys
 * reach the format (FMIR's next revision), a count that differs keeps every
 * server row, removes nothing, and fails the island with a coded error, in
 * every build. Strict initial validation also requires keyed rows to agree;
 * keyed reconciliation creates, removes and moves rows only after commit.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSignal, createRoot, onError } from 'forma/reactive';
import { h } from '../element';
import { mount } from '../mount';
import { adoptInRoot } from './helpers/owned-adoption.js';
import { activateIslands } from '../activate';
import { createShow } from '../show';
import { createList } from '../list';
import { hydrateIsland } from '../hydrate';

const CODE = 'FORMA_E_HYDRATE_LIST_COUNT';

afterEach(() => {
  document.body.innerHTML = '';
});

/** An unkeyed server list region of `rows` inside a `ul`. */
const serverList = (rows: string[]): string =>
  `<ul><!--f:l0-->${rows.map((r) => `<li>${r}</li>`).join('')}<!--/f:l0--></ul>`;

/** A list island whose rows are matched by index. */
const listIsland = (items: () => string[]) =>
  h('div', null, h('ul', null, createList(items, (x) => x, (x) => h('li', null, x))));

/** Every coded error onError receives, with its source, while `fn` runs. */
function captureErrors(fn: () => void): { received: Array<[string, string | undefined]>; logged: string[] } {
  const received: Array<[string, string | undefined]> = [];
  const off = onError((err, info) => {
    received.push([String((err as { code?: unknown }).code), info?.source]);
  });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { subtree: true, attributes: true, characterData: true, childList: true });
  const hosts = new Set(document.querySelectorAll('[data-forma-island]'));
  let writes: MutationRecord[] = [];
  let logged: string[] = [];
  try {
    fn();
  } finally {
    off();
    writes = observer.takeRecords(); observer.disconnect();
    logged = error.mock.calls.map(call => String(call[0]));
    error.mockRestore();
  }
  // Strict validation may report a compiled-host failure, never repair its DOM.
  expect(writes.every(record => record.type === 'attributes' && record.attributeName === 'data-forma-status'
    && hosts.has(record.target as Element) && (record.target as Element).getAttribute('data-forma-status') === 'error')).toBe(true);
  return { received, logged };
}

/** The nodes under `root`, in document order, for identity comparison. */
const nodesUnder = (root: Element): Node[] => {
  const out: Node[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
};

describe('list adoption row-count check', () => {
  describe.each([
    ["a client array shorter than the server's rows", ['a', 'b']],
    ["a client array longer than the server's rows", ['a', 'b', 'c', 'd']],
    ['an empty client array, as before its signal is seeded (ksx #5)', [] as string[]],
  ])('%s', (_label, clientItems) => {
    it('marks the island error with FORMA_E_HYDRATE_LIST_COUNT and removes or adds no row', () => {
      document.body.innerHTML =
        `<div data-forma-island="0" data-forma-component="Mismatch">${serverList(['a', 'b', 'c'])}</div>` +
        `<div data-forma-island="1" data-forma-component="Agrees">${serverList(['x', 'y'])}</div>`;
      installState();
      const mismatch = document.querySelector('[data-forma-island="0"]')!;
      const before = mismatch.innerHTML;
      const serverNodes = nodesUnder(mismatch);
      const [items, setItems] = createSignal(clientItems);

      const { received, logged } = captureErrors(() => {
        activateIslands(emptyRegistry({
          Mismatch: () => listIsland(items),
          Agrees: () => listIsland(() => ['x', 'y']),
        }));
      });

      const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
      expect(statuses).toEqual(['error', null]);
      expect(mismatch.innerHTML).toBe(before);
      expect(nodesUnder(mismatch)).toEqual(serverNodes);
      expect(received).toEqual([[CODE, 'hydration']]);
      const coded = logged.filter((line) => line.includes(CODE));
      expect(coded).toHaveLength(1);
      expect(coded[0]).toContain('"Mismatch"');
      expect(coded[0]).toContain(clientItems.length>3?'server range exhausted after 3 prepared items':`${3-clientItems.length} unconsumed top-level DOM node`);
      expect(coded[0]).toContain(`${clientItems.length} item`);

      // The failed island is inert: later updates reach no row.
      for (const next of [['a', 'b', 'c'], ['c'], ['d', 'e', 'f', 'g']]) {
        setItems(next);
        expect(mismatch.innerHTML).toBe(before);
      }
    });
  });

  it('a server region with no rows and a client array with items fails the island and inserts nothing', () => {
    document.body.innerHTML = `<div data-forma-island="0" data-forma-component="Empty">${serverList([])}</div>`;
    installState();
    const island = document.querySelector('[data-forma-island="0"]')!;
    const before = island.innerHTML;

    const { received } = captureErrors(() => {
      activateIslands(emptyRegistry({ Empty: () => listIsland(() => ['a', 'b']) }));
    });

    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(island.innerHTML).toBe(before);
    expect(island.querySelectorAll('li')).toHaveLength(0);
    expect(received).toEqual([[CODE, 'hydration']]);
  });

  it('equal counts adopt 40 unkeyed rows in place by index, as before, and keep reconciling', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `r${i}`);
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="Rows">${serverList(rows)}</div>` +
      `<div data-forma-island="1" data-forma-component="Rows2">${serverList(['p', 'q'])}</div>`;
    installState();
    const serverRows = Array.from(document.querySelectorAll('[data-forma-island="0"] li'));
    const [items, setItems] = createSignal(rows);
    const clicked: string[] = [];

    const { received, logged } = captureErrors(() => {
      activateIslands(emptyRegistry({
        Rows: () => h('div', null, h('ul', null,
          createList(items, (x) => x, (x) => h('li', { onClick: () => clicked.push(x) }, x)))),
        Rows2: () => listIsland(() => ['p', 'q']),
      }));
    });

    expect(received).toEqual([]);
    expect(logged).toEqual([]);
    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual([null, null]);
    const adopted = Array.from(document.querySelectorAll('[data-forma-island="0"] li'));
    expect(adopted).toHaveLength(40);
    expect(adopted.every((li, i) => li === serverRows[i])).toBe(true);
    (adopted[0] as HTMLElement).click();
    (adopted[39] as HTMLElement).click();
    expect(clicked).toEqual(['r0', 'r39']);

    // After adoption the reconciler is keyed: a reversal moves the server rows.
    const reversed = rows.slice().reverse();
    setItems(reversed);
    const now = Array.from(document.querySelectorAll('[data-forma-island="0"] li'));
    expect(now.map((li) => li.textContent)).toEqual(reversed);
    expect(now[0]).toBe(serverRows[39]);
    setItems(rows.slice(0, 2));
    expect(Array.from(document.querySelectorAll('[data-forma-island="0"] li'), (li) => li.textContent)).toEqual(['r0', 'r1']);
  });

  it('keyed initial count mismatch refuses without removing or replacing any server row', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Keyed"><ul><!--f:l0-->' +
      '<li data-forma-key="a">a</li><li data-forma-key="b">b</li><li data-forma-key="c">c</li>' +
      '<!--/f:l0--></ul></div>';
    installState();
    const [a, b, c] = Array.from(document.querySelectorAll('li'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { received } = captureErrors(() => {
      activateIslands(emptyRegistry({ Keyed: () => listIsland(() => ['a', 'c']) }));
    });
    warn.mockRestore();

    // Keyed rows are matched by key (FORMA-181 checkpoint C): a key on one side only is
    // FORMA_E_HYDRATE_KEY before any row is walked. FORMA-123's count check stays the
    // diagnostic for unkeyed rows (original in docs/archive/2026-10-15-pre-key-adoption/).
    expect(received).toEqual([['FORMA_E_HYDRATE_KEY', 'hydration']]);
    expect(document.querySelector('[data-forma-island="0"]')!.getAttribute('data-forma-status')).toBe('error');
    const now = Array.from(document.querySelectorAll('li'));
    expect(now).toEqual([a, b, c]);
    expect(document.body.contains(b!)).toBe(true);
  });

  it('a mismatched list inside a show branch fails its island', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Nested"><section><!--f:s0-->' +
      serverList(['a', 'b']) +
      '<!--/f:s0--></section></div>';
    installState();
    const island = document.querySelector('[data-forma-island="0"]')!;
    const before = island.innerHTML;

    const { received } = captureErrors(() => {
      activateIslands(emptyRegistry({
        Nested: () => h('div', null, h('section', null,
          createShow(() => true, () => h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))))),
      }));
    });

    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(island.innerHTML).toBe(before);
    expect(received).toEqual([[CODE, 'hydration']]);
  });

  it('the migration: an empty server region adopts an empty array, and rows filled after activation render', () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="Later"><h2>Recent</h2>${serverList([])}</div>`;
    installState();
    const [items, setItems] = createSignal<string[]>([]);
    const { received } = captureErrors(() => {
      activateIslands(emptyRegistry({ Later: () => h('div', null, h('h2', null, 'Recent'), h('ul', null, createList(items, (x) => x, (x) => h('li', null, x)))) }));
    });
    const island = document.querySelector('[data-forma-island="0"]')!;
    expect(island.getAttribute('data-forma-status')).toBeNull();
    expect(received).toEqual([]);
    for (const next of [['a', 'b'], ['b'], ['c', 'b', 'a']]) {
      setItems(next);
      expect(Array.from(island.querySelectorAll('li'), (li) => li.textContent)).toEqual(next);
    }
  });

  it('a bare empty server list refuses nonempty initial items without a CSR fallback', () => {
    // Empty server markers still form an authenticated SSR range, never a CSR fallback.
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="Bare"><!--f:l0--><!--/f:l0--></div>';
    installState();
    const { received } = captureErrors(() => {
      activateIslands(emptyRegistry({ Bare: () => h('div', null, createList(() => ['a', 'b'], (x) => x, (x) => h('p', null, x))) }));
    });
    const island = document.querySelector('[data-forma-island="0"]')!;
    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(received).toEqual([[CODE, 'hydration']]);
    expect(Array.from(island.querySelectorAll('p'), (p) => p.textContent)).toEqual([]);
    expect(island.innerHTML).toBe('<!--f:l0--><!--/f:l0-->');
  });

  it('the coded message reports known client items and unconsumed DOM without inventing server row counts', () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="One">${serverList(['a'])}</div>` +
      `<div data-forma-island="1" data-forma-component="Two">${serverList(['a', 'b'])}</div>`;
    installState();
    const { logged } = captureErrors(() => {
      activateIslands(emptyRegistry({ One: () => listIsland(() => []), Two: () => listIsland(() => ['a']) }));
    });
    const coded = logged.filter((line) => line.includes(CODE));
    expect(coded).toHaveLength(2);
    expect(coded[0]).toContain('1 unconsumed top-level DOM node');
    expect(coded[0]).toContain('has 0 items,');
    expect(coded[1]).toContain('1 unconsumed top-level DOM node');
    expect(coded[1]).toContain('has 1 item,');
  });

  it('initial tag drift refuses before creating missing rows or Show content, and leaves all handlers inert', () => {
    // A strict transaction refuses its first mismatch before allocating any repair.
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Fresh"><span>go</span>' +
      '<ol><!--f:l0--><li data-forma-key="a">a</li><!--/f:l0--></ol>' +
      '<section><!--f:s0--><!--/f:s0--></section>' +
      `${serverList(['x', 'y'])}</div>`;
    installState();
    const original = document.querySelector('[data-forma-island]')!;
    const before = original.innerHTML;
    const originalNodes = nodesUnder(original);
    const clicks: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { received } = captureErrors(() => {
      activateIslands(emptyRegistry({
        Fresh: () => h('div', null,
          h('button', { id: 'drift', onClick: () => clicks.push('drift') }, 'go'),
          h('ol', null, createList(() => ['a', 'b'], (k) => k, (k) => h('li', { id: `row-${k}`, onClick: () => clicks.push(k) }, k))),
          h('section', null, createShow(() => true, () => h('button', { id: 'branch', onClick: () => clicks.push('branch') }, 'b'))),
          h('ul', null, createList(() => ['x'], (k) => k, (k) => h('li', null, k)))),
      }));
    });
    warn.mockRestore();

    const island = document.querySelector('[data-forma-island="0"]')!;
    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(received).toEqual([['FORMA_E_HYDRATE_NODE', 'hydration']]);
    expect(island.innerHTML).toBe(before);
    expect(nodesUnder(island)).toEqual(originalNodes);
    const nodes = ['#drift', '#row-b', '#branch'].map(sel => island.querySelector(sel));
    expect(nodes).toEqual([null, null, null]);
    island.querySelector<HTMLElement>('li[data-forma-key="a"]')!.click();
    expect(clicks).toEqual([]);
  });

  // Ref callbacks are deferred until commit. A failed preparation must not
  // write another root's signal, and must not own that root's later updates.
  it("a refused island never runs its ref and leaves another island's later list row owned", () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="A"><ul><!--f:l0--><li>r0</li><!--/f:l0--></ul></div>` +
      `<div data-forma-island="1" data-forma-component="B"><div>x</div>${serverList(['a', 'b'])}</div>`;
    installState();
    const [rows, setRows] = createSignal(['r0']);
    const clicks: string[] = [];
    captureErrors(() => {
      activateIslands(emptyRegistry({
        A: () => h('div', null, h('ul', null, createList(rows, (r) => r, (r) => h('li', { onClick: () => clicks.push(r) }, r)))),
        B: () => h('div', null,
          h('div', { ref: () => setRows(['r0', 'r1']) }, 'x'),
          h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))),
      }));
    });
    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual([null, 'error']);
    const original = document.querySelector('[data-forma-island="0"] li');
    expect(rows()).toEqual(['r0']);
    expect(Array.from(document.querySelectorAll('[data-forma-island="0"] li'), li => li.textContent)).toEqual(['r0']);
    setRows(['r0', 'r1']);
    expect(document.querySelector('[data-forma-island="0"] li')).toBe(original);
    const aRows = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island="0"] li'));
    expect(aRows.map((li) => li.textContent)).toEqual(['r0', 'r1']);
    for (const li of aRows) li.click();
    expect(clicks).toEqual(['r0', 'r1']);
  });

  it("a refused island never runs its ref and leaves another island's later Show branch owned", () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="A"><section><!--f:s0--><!--/f:s0--></section></div>` +
      `<div data-forma-island="1" data-forma-component="B"><div>x</div>${serverList(['a', 'b'])}</div>`;
    installState();
    const [open, setOpen] = createSignal(false);
    const clicks: string[] = [];
    captureErrors(() => {
      activateIslands(emptyRegistry({
        A: () => h('div', null, h('section', null, createShow(open, () => h('button', { id: 'a-btn', onClick: () => clicks.push('a') }, 'a')))),
        B: () => h('div', null,
          h('div', { ref: () => setOpen(true) }, 'x'),
          h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))),
      }));
    });
    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual([null, 'error']);
    expect(open()).toBe(false);
    expect(document.getElementById('a-btn')).toBeNull();
    setOpen(true);
    document.getElementById('a-btn')!.click();
    expect(clicks).toEqual(['a']);
  });

  // The same isolation applies to independently owned Browser mount roots.
  it("a failing caller-owned adoption whose ref writes a shared signal does not detach a Browser mount root's new row", () => {
    document.body.innerHTML =
      `<div id="app2"></div><div id="app1" data-forma-ssr><div><div>x</div>${serverList(['a', 'b'])}</div></div>`;
    const [rows, setRows] = createSignal(['r0']);
    const clicks: string[] = [];
    mount(() => h('ul', null, createList(rows, (r) => r, (r) => h('li', { onClick: () => clicks.push(r) }, r))) as unknown as HTMLElement, '#app2');
    captureErrors(() => {
      adoptInRoot((() => h('div', null,
        h('div', { ref: () => setRows(['r0', 'r1']) }, 'x'),
        h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x))))) as unknown as () => HTMLElement, '#app1');
    });
    expect(document.getElementById('app1')!.hasAttribute('data-forma-ssr')).toBe(true);
    const original = document.querySelector('#app2 li');
    expect(rows()).toEqual(['r0']);
    expect(Array.from(document.querySelectorAll('#app2 li'), li => li.textContent)).toEqual(['r0']);
    setRows(['r0', 'r1']);
    expect(document.querySelector('#app2 li')).toBe(original);
    const lis = Array.from(document.querySelectorAll<HTMLElement>('#app2 li'));
    expect(lis.map((li) => li.textContent)).toEqual(['r0', 'r1']);
    for (const li of lis) li.click();
    expect(clicks).toEqual(['r0', 'r1']);
  });

  it("a failing island's ref that writes a shared signal does not detach a client-rendered mount() root's new row", () => {
    document.body.innerHTML =
      `<div id="app2"></div><div data-forma-island="0" data-forma-component="B"><div>x</div>${serverList(['a', 'b'])}</div>`;
    installState();
    const [rows, setRows] = createSignal(['r0']);
    const clicks: string[] = [];
    mount(() => h('ul', null, createList(rows, (r) => r, (r) => h('li', { onClick: () => clicks.push(r) }, r))) as unknown as HTMLElement, '#app2');
    captureErrors(() => {
      activateIslands(emptyRegistry({
        B: () => h('div', null,
          h('div', { ref: () => setRows(['r0', 'r1']) }, 'x'),
          h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))),
      }));
    });
    expect(document.querySelector('[data-forma-island="0"]')!.getAttribute('data-forma-status')).toBe('error');
    const original = document.querySelector('#app2 li');
    expect(rows()).toEqual(['r0']);
    expect(Array.from(document.querySelectorAll('#app2 li'), li => li.textContent)).toEqual(['r0']);
    setRows(['r0', 'r1']);
    expect(document.querySelector('#app2 li')).toBe(original);
    const lis = Array.from(document.querySelectorAll<HTMLElement>('#app2 li'));
    expect(lis.map((li) => li.textContent)).toEqual(['r0', 'r1']);
    for (const li of lis) li.click();
    expect(clicks).toEqual(['r0', 'r1']);
  });

  it("a failing caller-owned adoption whose ref writes a shared signal leaves another island's new row its handler", () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="A"><ul><!--f:l0--><li>r0</li><!--/f:l0--></ul></div>` +
      `<div id="app1" data-forma-ssr><div><div>x</div>${serverList(['a', 'b'])}</div></div>`;
    installState();
    const [rows, setRows] = createSignal(['r0']);
    const clicks: string[] = [];
    activateIslands(emptyRegistry({ A: () => h('div', null, h('ul', null, createList(rows, (r) => r, (r) => h('li', { onClick: () => clicks.push(r) }, r)))) }));
    captureErrors(() => {
      adoptInRoot((() => h('div', null,
        h('div', { ref: () => setRows(['r0', 'r1']) }, 'x'),
        h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x))))) as unknown as () => HTMLElement, '#app1');
    });
    const original = document.querySelector('[data-forma-island="0"] li');
    expect(rows()).toEqual(['r0']);
    expect(Array.from(document.querySelectorAll('[data-forma-island="0"] li'), li => li.textContent)).toEqual(['r0']);
    setRows(['r0', 'r1']);
    expect(document.querySelector('[data-forma-island="0"] li')).toBe(original);
    const lis = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island="0"] li'));
    expect(lis.map((li) => li.textContent)).toEqual(['r0', 'r1']);
    for (const li of lis) li.click();
    expect(clicks).toEqual(['r0', 'r1']);
  });

  it("another island's later row keeps its reactive binding after a refused adoption", () => {
    // A failed ref must not create the row. An explicit later update belongs
    // to the successful island and retains its independent reactive binding.
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="A"><ul><!--f:l0--><li><!--f:t0-->r0:<!--/f:t0--></li><!--/f:l0--></ul></div>` +
      `<div data-forma-island="1" data-forma-component="B"><div>x</div>${serverList(['a', 'b'])}</div>`;
    installState();
    const [rows, setRows] = createSignal(['r0']);
    const [tag, setTag] = createSignal('');
    captureErrors(() => {
      activateIslands(emptyRegistry({
        A: () => h('div', null, h('ul', null, createList(rows, (r) => r, (r) => h('li', null, () => `${r}:${tag()}`)))),
        B: () => h('div', null,
          h('div', { ref: () => setRows(['r0', 'r1']) }, 'x'),
          h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))),
      }));
    });
    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual([null, 'error']);
    expect(rows()).toEqual(['r0']);
    expect(document.querySelectorAll('[data-forma-island="0"] li')).toHaveLength(1);
    setRows(['r0', 'r1']);
    for (const next of ['t', 'u', 'v']) {
      setTag(next);
      expect(Array.from(document.querySelectorAll('[data-forma-island="0"] li'), (li) => li.textContent)).toEqual([`r0:${next}`, `r1:${next}`]);
    }
  });

  it('a refused island never runs the ref that would create a portal outside every island', () => {
    document.body.innerHTML =
      `<div id="outside"></div><div data-forma-island="0" data-forma-component="B"><div>x</div>${serverList(['a', 'b'])}</div>`;
    installState();
    const clicks: string[] = [];
    captureErrors(() => {
      activateIslands(emptyRegistry({
        B: () => h('div', null,
          h('div', { ref: () => document.getElementById('outside')!.appendChild(h('button', { id: 'out', onClick: () => clicks.push('out') }, 'o')) }, 'x'),
          h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))),
      }));
    });
    expect(document.querySelector('[data-forma-island="0"]')!.getAttribute('data-forma-status')).toBe('error');
    expect(document.getElementById('out')).toBeNull();
    expect(document.getElementById('outside')!.childNodes).toHaveLength(0);
    expect(clicks).toEqual([]);
  });

  it('hydrateIsland() called directly keeps no binding it adopted before the list failed', () => {
    document.body.innerHTML = `<div id="direct" data-forma-ssr><div><span><!--f:t0-->idle<!--/f:t0--></span>${serverList(['a', 'b'])}</div></div>`;
    const target = document.getElementById('direct')!;
    const [label, setLabel] = createSignal('idle');
    let dispose!: () => void;

    const { received } = captureErrors(() => {
      createRoot((d) => {
        dispose = d;
        hydrateIsland(() => h('div', null,
          h('span', null, () => label()),
          h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))), target);
      });
    });

    expect(received).toEqual([[CODE, 'hydration']]);

    // The caller's root is alive, yet nothing adopted before the failure writes.
    for (const next of ['busy', 'done', 'idle again']) {
      setLabel(next);
      expect(target.querySelector('span')!.textContent).toBe('idle');
    }
    expect(target.hasAttribute('data-forma-ssr')).toBe(true);
    dispose();
  });

  it('an island failed by the row count keeps no handler or binding that adoption attached before the list', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Bad"><button>go</button><span><!--f:t0-->idle<!--/f:t0--></span>' + serverList(['a', 'b']) + '</div>' +
      '<div data-forma-island="1" data-forma-component="Good"><button>go</button><span><!--f:t0-->idle<!--/f:t0--></span>' + serverList(['a', 'b']) + '</div>';
    installState();
    const [label, setLabel] = createSignal('idle');
    const clicks: string[] = [];
    const island = (name: string, items: string[]) => () => h('div', null,
      h('button', { onClick: () => clicks.push(name) }, 'go'),
      h('span', null, () => label()),
      h('ul', null, createList(() => items, (x) => x, (x) => h('li', null, x))));

    captureErrors(() => {
      activateIslands(emptyRegistry({ Bad: island('Bad', ['a']), Good: island('Good', ['a', 'b']) }));
    });

    const [bad, good] = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    expect([bad!.getAttribute('data-forma-status'), good!.getAttribute('data-forma-status')]).toEqual(['error', null]);
    bad!.querySelector('button')!.click();
    good!.querySelector('button')!.click();
    expect(clicks).toEqual(['Good']);
    for (const next of ['busy', 'done', 'idle again']) {
      setLabel(next);
      expect(bad!.querySelector('span')!.textContent).toBe('idle');
      expect(good!.querySelector('span')!.textContent).toBe(next);
    }
  });

  it('onError receives FORMA_E_HYDRATE_LIST_COUNT from activateIslands, caller-owned adoption and hydrateIsland(), and each keeps the server rows', () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="Short">${serverList(['a', 'b'])}</div>` +
      `<div id="app" data-forma-ssr>${serverList(['a', 'b'])}</div>` +
      `<div id="direct" data-forma-ssr>${serverList(['a', 'b'])}</div>`;
    installState();
    const before = document.body.innerHTML.replace(/ data-forma-status="[a-z]+"/, '');
    const short = () => h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)));
    let dispose: (() => void) | undefined;

    const { received, logged } = captureErrors(() => {
      activateIslands(emptyRegistry({ Short: () => h('div', null, short()) }));
      expect(() => { dispose = adoptInRoot(short as unknown as () => HTMLElement, '#app'); }).not.toThrow();
      expect(() => hydrateIsland(short, document.getElementById('direct')!)).not.toThrow();
    });

    expect(received).toEqual([[CODE, 'hydration'], [CODE, 'hydration'], [CODE, 'hydration']]);
    expect(logged.filter((line) => line.includes(CODE))).toHaveLength(3);
    expect(document.body.innerHTML.replace(/ data-forma-status="[a-z]+"/, '')).toBe(before);
    expect(document.getElementById('app')!.hasAttribute('data-forma-ssr')).toBe(true);
    expect(document.getElementById('direct')!.hasAttribute('data-forma-ssr')).toBe(true);
    expect(typeof dispose).toBe('function');
  });
});

useFreshDocument();
