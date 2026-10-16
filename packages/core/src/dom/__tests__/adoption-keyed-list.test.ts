/**
 * FORMA-181 checkpoint C: strict adoption binds keyed rows by key (DR-8; PLAN.md section 5).
 *
 * The native walker writes each keyed row's canonical key text as the row root's
 * `data-forma-key`. Adoption snapshots the served rows of the LIST range in their physical
 * order, binds each client item to the row whose decoded attribute equals the item's
 * canonical key (`canonicalKeyText`), walks it through a cursor bounded to that row, and
 * moves nothing. The first real list update reconciles the client's order against the served
 * order. A key on one side only, a repeated key or a key outside the domain refuses
 * FORMA_E_HYDRATE_KEY before any row runs; anything else at the rows' level is a structural
 * refusal.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { onError } from 'forma/reactive';
import { prepareAdoption } from '../adoption.js';
import { h, fragment } from '../element.js';
import { createList } from '../list.js';
import { createSignal } from '../../reactive/signal.js';
import { activateIslands } from '../activate.js';
import { __islandRegistration, preflightIslands, type ValidatedIsland, type IslandSchema } from '../island-state.js';
import { emptyRegistry, installState } from './helpers/compiled-island.js';

type Row = { id: unknown; text: string };
const H = '0123456789abcdef';

function fixture(body: string, tag = 'ul') {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = `<${tag}><!--f:l0-->${body}<!--/f:l0--></${tag}>`;
  const host = doc.body.firstElementChild!, batches: MutationRecord[] = [];
  const observer = new MutationObserver(batch => batches.push(...batch));
  observer.observe(host, { attributes: true, childList: true, characterData: true, subtree: true });
  // Delivered batches are retained as well as the pending ones, so a write a microtask or a
  // macrotask after commit is seen, not only what is still queued at the assertion.
  return {
    doc, host,
    records: () => batches.splice(0).concat(observer.takeRecords()),
    disconnect: () => observer.disconnect(),
  };
}
const served = (rows: [string, string][]) => rows.map(([key, text]) => `<li data-forma-key="${key}">${text}</li>`).join('');
const drain = async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
const list = (items: () => Row[], render = (row: Row) => h('li', null, row.text)) =>
  () => h('ul', null, createList(items, row => row.id as string, render));

describe('keyed list adoption (FORMA-181 checkpoint C)', () => {
  it('binds reversed client keys to the same served nodes with no write through a microtask and a macrotask, then a real update reorders', async () => {
    const f = fixture(served([['a', 'A'], ['b', 'B'], ['c', 'C']])), before = [...f.host.childNodes];
    const [a, b, c] = [...f.host.querySelectorAll('li')];
    const [items, setItems] = createSignal<Row[]>([{ id: 'c', text: 'C' }, { id: 'b', text: 'B' }, { id: 'a', text: 'A' }]);
    const clicked: unknown[] = [];
    const plan = prepareAdoption(f.host, list(items, (row: Row) => h('li', { onClick: () => clicked.push(row.id) }, row.text)));
    plan.commit();
    await drain();
    expect([...f.host.childNodes]).toEqual(before);
    expect(f.records()).toEqual([]);
    a!.click(); c!.click();
    expect(clicked).toEqual(['a', 'c']);

    // Positive control: the observer does see the first real update, which moves the rows into
    // the client's order without rebuilding one.
    setItems([{ id: 'c', text: 'C' }, { id: 'b', text: 'B' }, { id: 'a', text: 'A' }]);
    expect([...f.host.querySelectorAll('li')]).toEqual([c, b, a]);
    expect(f.records().some(record => record.type === 'childList')).toBe(true);
    plan.dispose(); f.disconnect();
  });

  // The compiler admits no index expression; the public API's index starts at the client's
  // logical position, never the served one (PLAN.md section 5).
  it('gives each row its logical client index, before and after the first update', () => {
    const f = fixture(served([['a', 'A'], ['b', 'B'], ['c', 'C']]));
    const [items, setItems] = createSignal<Row[]>([{ id: 'c', text: 'C' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
    const indexes = new Map<unknown, () => number>();
    const plan = prepareAdoption(f.host, () => h('ul', null, createList(items, row => row.id as string, (row, index) => {
      indexes.set(row.id, index);
      return h('li', null, row.text);
    })));
    plan.commit();
    expect(['a', 'b', 'c'].map(id => indexes.get(id)!())).toEqual([1, 2, 0]);
    setItems([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }]);
    expect(['a', 'b', 'c'].map(id => indexes.get(id)!())).toEqual([0, 1, 2]);
    expect(f.host.textContent).toBe('ABC');
    plan.dispose(); f.disconnect();
  });

  it('compares the decoded attribute with the canonical key text: numbers, -0, line endings and NUL', async () => {
    // What the walker writes for 1, -0, "a\r\nb" and "x\0" (value rule 1 on string keys).
    const f = fixture(`<li data-forma-key="1">one</li><li data-forma-key="0">zero</li><li data-forma-key="a\nb">crlf</li><li data-forma-key="x�">nul</li>`);
    const before = [...f.host.childNodes];
    const rows: Row[] = [{ id: 'x\0', text: 'nul' }, { id: 'a\r\nb', text: 'crlf' }, { id: -0, text: 'zero' }, { id: 1, text: 'one' }];
    const plan = prepareAdoption(f.host, list(() => rows));
    plan.commit();
    await drain();
    expect([...f.host.childNodes]).toEqual(before);
    expect(f.records()).toEqual([]);
    plan.dispose(); f.disconnect();
  });

  it('treats a type-only key change as the same row on a later update', () => {
    const f = fixture(served([['1', 'one'], ['2', 'two']]));
    const [one] = [...f.host.querySelectorAll('li')];
    const [items, setItems] = createSignal<Row[]>([{ id: 1, text: 'one' }, { id: 2, text: 'two' }]);
    const render = vi.fn((row: Row) => h('li', null, row.text));
    const plan = prepareAdoption(f.host, list(items, render));
    plan.commit();
    expect(render).toHaveBeenCalledTimes(2);
    setItems([{ id: '1', text: 'one' }, { id: '2', text: 'two' }]);
    expect(render).toHaveBeenCalledTimes(2);
    expect(f.host.querySelector('li')).toBe(one);
    plan.dispose(); f.disconnect();
  });

  it('refuses a key on one side only, a repeated key or a key outside the domain with FORMA_E_HYDRATE_KEY before any row runs', () => {
    const cases: [string, string, unknown[]][] = [
      ['a served row the client lacks', served([['a', 'A'], ['b', 'B'], ['c', 'C']]), ['a', 'c']],
      ['a client key the server lacks', served([['a', 'A'], ['b', 'B']]), ['a', 'x']],
      ['a served key twice', served([['a', 'A'], ['a', 'A'], ['b', 'B']]), ['a', 'b']],
      ['a served row without a key beside keyed rows', '<li data-forma-key="a">A</li><li>B</li>', ['a', 'b']],
      ['one canonical key twice on the client (1 and "1")', served([['1', '1'], ['2', '2']]), [1, '1']],
      ['a client key that is a fraction', served([['1', '1'], ['2', '2']]), [1.5, 2]],
      ['a client key that is null', served([['1', '1'], ['2', '2']]), [null, 2]],
      ['a client key with an unpaired surrogate', served([['�', 'x']]), ['\uD800']],
    ];
    for (const [label, body, keys] of cases) {
      const f = fixture(body), before = f.host.outerHTML, nodes = [...f.host.childNodes];
      const render = vi.fn((row: Row) => h('li', null, row.text));
      expect(() => prepareAdoption(f.host, list(() => keys.map(id => ({ id, text: String(id) })), render)), label)
        .toThrow('FORMA_E_HYDRATE_KEY');
      expect(render, label).not.toHaveBeenCalled();
      expect(f.host.outerHTML, label).toBe(before);
      expect([...f.host.childNodes], label).toEqual(nodes);
      expect(f.records(), label).toEqual([]);
      f.disconnect();
    }
  });

  it('refuses content beside keyed rows, a wrong root and a row that reaches past its own root', () => {
    const cases: [string, string, () => unknown, string][] = [
      ['text beside a keyed row', `${served([['a', 'A']])}text`, list(() => [{ id: 'a', text: 'A' }]), 'FORMA_E_HYDRATE_STRUCTURE'],
      ['a dynamic range beside a keyed row', `${served([['a', 'A']])}<!--f:t0-->x<!--/f:t0-->`, list(() => [{ id: 'a', text: 'A' }]), 'FORMA_E_HYDRATE_STRUCTURE'],
      ['an envelope that holds more than the root', '<!--f:i0--><li data-forma-key="a">A</li><b></b><!--/f:i0-->', list(() => [{ id: 'a', text: 'A' }]), 'FORMA_E_HYDRATE_STRUCTURE'],
      ['a served root of another tag', '<p data-forma-key="a">A</p>', list(() => [{ id: 'a', text: 'A' }]), 'FORMA_E_HYDRATE_NODE'],
      ['a row that would consume the next row', served([['a', 'A'], ['b', 'B']]),
        () => h('ul', null, createList(() => [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], row => row.id, row => fragment(h('li', null, row.text), h('li', null, 'B')) as unknown as HTMLElement)),
        'FORMA_E_HYDRATE_NODE'],
      ['a row that leaves part of its root unconsumed', '<li data-forma-key="a">A</li>',
        () => h('ul', null, createList(() => [{ id: 'a', text: 'A' }], row => row.id, () => fragment() as unknown as HTMLElement)),
        'FORMA_E_HYDRATE_STRUCTURE'],
    ];
    for (const [label, body, build, code] of cases) {
      const f = fixture(body), before = f.host.outerHTML;
      expect(() => prepareAdoption(f.host, build), label).toThrow(code);
      expect(f.host.outerHTML, label).toBe(before);
      expect(f.records(), label).toEqual([]);
      f.disconnect();
    }
  });

  it('refuses at commit when a served key changed after preparation, writing nothing', () => {
    const f = fixture(served([['a', 'A'], ['b', 'B']])), before = [...f.host.childNodes];
    const plan = prepareAdoption(f.host, list(() => [{ id: 'b', text: 'B' }, { id: 'a', text: 'A' }]));
    f.host.querySelector('li')!.setAttribute('data-forma-key', 'z');
    f.records();
    expect(() => plan.commit()).toThrow('FORMA_E_HYDRATE_VALUE');
    expect([...f.host.childNodes]).toEqual(before);
    expect(f.records()).toEqual([]);
    f.disconnect();
  });

  it('binds nested keyed lists by key at both levels; marker numbers and keys repeat per outer row', async () => {
    const f = fixture(
      '<li data-forma-key="g1"><!--f:l1--><b data-forma-key="1">a</b><b data-forma-key="2">b</b><!--/f:l1--></li>' +
      '<li data-forma-key="g2"><!--f:l1--><b data-forma-key="1">c</b><!--/f:l1--></li>');
    const before = [...f.host.querySelectorAll('*')];
    type Group = { id: string; items: () => Row[] };
    const [inner, setInner] = createSignal<Row[]>([{ id: 2, text: 'b' }, { id: 1, text: 'a' }]);
    const groups: Group[] = [{ id: 'g2', items: () => [{ id: 1, text: 'c' }] }, { id: 'g1', items: inner }];
    const plan = prepareAdoption(f.host, () => h('ul', null, createList(() => groups, group => group.id,
      group => h('li', null, createList(group.items, row => row.id as string, row => h('b', null, row.text))))));
    plan.commit();
    await drain();
    expect([...f.host.querySelectorAll('*')]).toEqual(before);
    expect(f.records()).toEqual([]);
    // An update inside g1 moves g1's rows only.
    const [a, b, c] = [...f.host.querySelectorAll('b')];
    setInner([{ id: 2, text: 'b' }, { id: 1, text: 'a' }]);
    expect([...f.host.querySelectorAll('b')]).toEqual([b, a, c]);
    plan.dispose(); f.disconnect();
  });

  it('binds keyed registered children by key: each client row matches its own host, state and occurrence', async () => {
    const schema: IslandSchema = [[{ name: 'count', type: { kind: 'number' } }]];
    const host = (occurrence: number, key: string, text: string) =>
      `<!--f:i0--><button data-forma-island="0" data-forma-component="A" data-forma-state="${occurrence}" data-forma-h="${H}" data-forma-key="${key}">${text}</button><!--/f:i0-->`;
    const setup = () => {
      const f = fixture(host(0, '1', 'one') + host(1, '2', 'two'));
      const state = f.doc.createElement('script');
      state.type = 'application/json'; state.setAttribute('data-island-state', '');
      state.textContent = JSON.stringify({ v: 1, s: [], i: [{ h: H, p: { count: 1 } }, { h: H, p: { count: 2 } }] });
      f.doc.head.append(state);
      const Child = vi.fn((props: Record<string, unknown>) => h('button', null, String(props.count)));
      const checked = preflightIslands({ A: __islandRegistration(Child, { h: H, schema, mode: 0 }) }, f.doc);
      const children = new Map<Element, ValidatedIsland>();
      for (const result of checked) { if ('error' in result) throw result.error; children.set(result.host, result.value); }
      return { f, Child, children };
    };
    const rows = (pairs: [number, number][]) => () => h('ul', null,
      createList(() => pairs.map(([id, count]) => ({ id, count })), row => row.id, row => h(Child, { count: row.count }) as unknown as HTMLElement));
    let Child!: ReturnType<typeof setup>['Child'];

    // Reversed client order: row 2 matches the host that holds count 2, occurrence 1.
    const ok = setup(); Child = ok.Child;
    const before = ok.f.host.outerHTML;
    const plan = prepareAdoption(ok.f.host, rows([[2, 2], [1, 1]]), { children: ok.children });
    plan.commit();
    await drain();
    expect(Child).not.toHaveBeenCalled();
    expect(ok.f.host.outerHTML).toBe(before);
    expect(ok.f.records()).toEqual([]);
    plan.dispose(); ok.f.disconnect();

    // Matching by position would pair key 2 with count 1's host; by key the props disagree
    // only when the client really gives key 2 another count.
    const bad = setup(); Child = bad.Child;
    expect(() => prepareAdoption(bad.f.host, rows([[2, 1], [1, 2]]), { children: bad.children })).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(Child).not.toHaveBeenCalled();
    expect(bad.f.records()).toEqual([]);
    bad.f.disconnect();
  });
});

describe('keyed list refusal isolation (FORMA-181 checkpoint C)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.head.querySelectorAll('[data-island-state]').forEach(node => node.remove()); });

  it('a duplicate served key fails only its own island with FORMA_E_HYDRATE_KEY; the neighbouring keyed island activates', () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="Broken"><ul><!--f:l0-->${served([['a', 'A'], ['a', 'A'], ['b', 'B']])}<!--/f:l0--></ul></div>` +
      `<div data-forma-island="1" data-forma-component="Fine"><ul><!--f:l0-->${served([['a', 'A'], ['b', 'B']])}<!--/f:l0--></ul></div>`;
    installState();
    const [broken, fine] = [...document.querySelectorAll('[data-forma-island]')];
    const brokenBefore = broken!.innerHTML, fineNodes = [...fine!.querySelectorAll('li')];
    const received: string[] = [], clicked: string[] = [];
    const off = onError((error, info) => { received.push(`${String((error as { code?: unknown }).code)}:${info?.source}`); });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const island = (rows: string[]) => () => h('div', null, h('ul', null,
      createList(() => rows, row => row, row => h('li', { onClick: () => clicked.push(row) }, row.toUpperCase()))));
    try {
      activateIslands(emptyRegistry({ Broken: island(['a', 'b']), Fine: island(['b', 'a']) }));
    } finally { off(); quiet.mockRestore(); }
    expect(received).toEqual(['FORMA_E_HYDRATE_KEY:hydration']);
    expect(broken!.getAttribute('data-forma-status')).toBe('error');
    expect(broken!.innerHTML).toBe(brokenBefore);
    expect(fine!.hasAttribute('data-forma-status')).toBe(false);
    expect([...fine!.querySelectorAll('li')]).toEqual(fineNodes);
    fineNodes[1]!.click();
    expect(clicked).toEqual(['b']);
  });
});

/** The originals of the core tests checkpoint C changed on purpose stay byte-exact. */
describe('archived pre-key-adoption tests', () => {
  it('keeps every archived original byte-exact under its manifest', () => {
    const archive = resolve(__dirname, '../../../../../docs/archive/2026-10-15-pre-key-adoption');
    const manifest = JSON.parse(readFileSync(join(archive, 'manifest.json'), 'utf8')) as { sha256: Record<string, { bytes: number; sha256: string }> };
    expect(Object.keys(manifest.sha256).sort()).toEqual([
      'packages/core/src/dom/__tests__/adoption-list.test.ts.txt',
      'packages/core/src/dom/__tests__/list-adoption-count.test.ts.txt',
      'packages/core/src/dom/__tests__/list-hydration.test.ts.txt',
    ]);
    for (const [name, entry] of Object.entries(manifest.sha256)) {
      const bytes = readFileSync(join(archive, name));
      expect(bytes.length, name).toBe(entry.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(entry.sha256);
    }
  });
});
