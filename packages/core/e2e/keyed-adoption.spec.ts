import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveOwnedAdoption } from './helpers/owned-adoption.js';

// FORMA-181 checkpoint C in the real engines (DR-8, DR-9). The native walker writes each keyed
// row's canonical key text as the row root's `data-forma-key`; strict adoption binds each client
// item to the served row whose decoded attribute equals the item's canonical key, moves nothing,
// and reconciles the client's order only on the first real update. The shared key vectors are the
// file forma-ir's walker and core's unit suite read; their `served` markup is pinned against the
// walker's output by crates/forma-ir/src/walker.rs > keyed_rows >
// "every_shared_key_vector_is_written_as_its_served_markup".
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

interface KeyVector { id: string; value: unknown; expected?: string; served?: string }
const vectors = (JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../crates/forma-ir/tests/fixtures/parity/keys.json', import.meta.url)), 'utf8',
)) as { values: KeyVector[] }).values.filter(vector => vector.served !== undefined);

async function serve(page: Page, body: string, state?: { h: string; p: object }[]): Promise<void> {
  await serveOwnedAdoption(page, '/adoption-core.mjs');
  await page.route('**/adoption-core.mjs', route => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript',
  }));
  const block = state ? `<script type="application/json" data-island-state>${JSON.stringify({ v: 1, s: [], i: state })}</script>` : '';
  // The vectors carry U+FFFD and supplementary characters: the document must say it is UTF-8.
  await page.route('**/keyed.html', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Keyed</title>${block}</head><body>${body}</body></html>`,
  }));
  await page.goto('/keyed.html');
}

test('every shared key vector: the served attribute decodes to its canonical text, and adoption keyed by the raw value binds it without a write', async ({ page }) => {
  expect(vectors.length).toBeGreaterThanOrEqual(20);
  await serve(page, vectors.map((vector, i) =>
    `<div id="k${i}"><ul><!--f:l0--><li data-forma-key="${vector.served}">${i}</li><!--/f:l0--></ul></div>`).join(''));
  const result = await page.evaluate(async (vectors) => {
    const { h, createList } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const decoded = vectors.map((_, i) => document.querySelector(`#k${i} li`)!.getAttribute('data-forma-key'));
    const nodes = vectors.map((_, i) => document.querySelector(`#k${i} li`));
    const failures: string[] = [];
    vectors.forEach((vector, i) => {
      try {
        adoptMatching(() => h('ul', null, createList(() => [{ key: vector.value }], (row: { key: unknown }) => row.key,
          () => h('li', null, String(i)))), `#k${i}`);
      } catch (error) { failures.push(`${vector.id}: ${(error as Error).message}`); }
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    observer.disconnect();
    return { decoded, failures, records: records.length,
      retained: vectors.every((_, i) => document.querySelector(`#k${i} li`) === nodes[i]) };
  }, vectors);
  expect(result.decoded).toEqual(vectors.map(vector => vector.expected));
  expect(result.failures).toEqual([]);
  expect(result).toMatchObject({ records: 0, retained: true });
});

const H = '0123456789abcdef';
const rows = (pairs: [string, string][]) => pairs.map(([key, text]) => `<li data-forma-key="${key}">${text}</li>`).join('');
const host = (id: number, name: string, body: string) =>
  `<div data-forma-island="${id}" data-forma-component="${name}" data-forma-state="${id}" data-forma-h="${H}">${body}</div>`;

test('activation binds keyed rows by key: reversed and nested rows adopt without a write, each refusal fails only its own island', async ({ page }) => {
  const nested = '<ul><!--f:l0-->' +
    '<li data-forma-key="g1"><!--f:l1--><b data-forma-key="1">a</b><b data-forma-key="2">b</b><!--/f:l1--></li>' +
    '<li data-forma-key="g2"><!--f:l1--><b data-forma-key="1">c</b><!--/f:l1--></li><!--/f:l0--></ul>';
  const list = (body: string) => `<ul><!--f:l0-->${body}<!--/f:l0--></ul>`;
  await serve(page,
    host(0, 'Reversed', list(rows([['a', 'A'], ['b', 'B'], ['c', 'C']]))) +
    host(1, 'ServerOnly', list(rows([['a', 'A'], ['b', 'B'], ['c', 'C']]))) +
    host(2, 'ClientOnly', list(rows([['a', 'A'], ['b', 'B']]))) +
    host(3, 'Duplicate', list(rows([['a', 'A'], ['a', 'A'], ['b', 'B']]))) +
    host(4, 'WrongRoot', list('<p data-forma-key="a">A</p>')) +
    host(5, 'Nested', nested),
    Array.from({ length: 6 }, () => ({ h: H, p: {} })));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`uncaught: ${error.message}`));
  // Node identity is compared inside the page: nodes do not serialize across evaluate.
  await page.evaluate(() => { (window as any).before = [...document.querySelectorAll('li, b, p')]; });

  const result = await page.evaluate(async () => {
    const records: string[] = [];
    const observer = new MutationObserver(batch => {
      for (const record of batch) {
        const island = ((record.target as Element).closest?.('[data-forma-island]') ?? record.target.parentElement?.closest('[data-forma-island]'))?.getAttribute('data-forma-island');
        records.push(`${record.type}:${island}:${record.attributeName ?? ''}`);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const { h, activateIslands, __islandRegistration, createList, createSignal, onError } = await import('/adoption-core.mjs' as string);
    const codes: string[] = [];
    onError((error: { code?: string }) => codes.push(String(error.code)));
    type Row = { id: string; text: string };
    const row = (id: string) => ({ id, text: id.toUpperCase() });
    const [reversed, setReversed] = createSignal([row('c'), row('b'), row('a')]);
    const [inner, setInner] = createSignal([{ id: '2', text: 'b' }, { id: '1', text: 'a' }]);
    Object.assign(window as any, { setReversed, setInner, row });
    const island = (items: () => Row[], tag = 'li') => () => h('ul', null,
      createList(items, (item: Row) => item.id, (item: Row) => h(tag, null, item.text)));
    const groups = [{ id: 'g2', items: () => [{ id: '1', text: 'c' }] }, { id: 'g1', items: inner }];
    const metadata = { h: '0123456789abcdef', schema: [[]], mode: 0 as const };
    const register = (component: () => unknown) => __islandRegistration(() => h('div', null, component()), metadata);
    await activateIslands({
      Reversed: register(island(reversed)),
      ServerOnly: register(island(() => [row('a'), row('c')])),
      ClientOnly: register(island(() => [row('a'), row('x')])),
      Duplicate: register(island(() => [row('a'), row('b')])),
      WrongRoot: register(island(() => [row('a')])),
      Nested: register(() => h('ul', null, createList(() => groups, (group: { id: string }) => group.id,
        (group: { items: () => Row[] }) => h('li', null, createList(group.items, (item: Row) => item.id, (item: Row) => h('b', null, item.text)))))),
    });
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords().map(record => `${record.type}:late`));
    observer.disconnect();
    return { codes, records };
  });

  expect(result.codes).toEqual(['FORMA_E_HYDRATE_KEY', 'FORMA_E_HYDRATE_KEY', 'FORMA_E_HYDRATE_KEY', 'FORMA_E_HYDRATE_NODE']);
  // The only writes are the four failed islands' status attributes: no row moved, no node replaced.
  expect(result.records.sort()).toEqual(['attributes:1:data-forma-status', 'attributes:2:data-forma-status',
    'attributes:3:data-forma-status', 'attributes:4:data-forma-status']);
  for (const id of [1, 2, 3, 4]) await expect(page.locator(`[data-forma-island="${id}"]`)).toHaveAttribute('data-forma-status', 'error');
  for (const id of [0, 5]) {
    await expect(page.locator(`[data-forma-island="${id}"]`)).not.toHaveAttribute('data-forma-status');
    expect(await page.locator(`[data-forma-island="${id}"]`).evaluate(el => typeof (el as any).__formaDispose)).toBe('function');
  }
  expect(await page.evaluate(() => {
    const before = (window as any).before as Element[], now = [...document.querySelectorAll('li, b, p')];
    return now.length === before.length && now.every((node, i) => node === before[i]);
  })).toBe(true);

  // Positive control: the first real update is seen, and moves the served rows without rebuilding one.
  const moved = await page.evaluate(async () => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(document.body, { subtree: true, childList: true });
    const island = document.querySelector('[data-forma-island="0"]')!, served = [...island.querySelectorAll('li')];
    const nested = document.querySelector('[data-forma-island="5"]')!, bold = [...nested.querySelectorAll('b')];
    const { setReversed, setInner, row } = window as any;
    setReversed([row('c'), row('b'), row('a')]);
    setInner([{ id: '2', text: 'b' }, { id: '1', text: 'a' }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    observer.disconnect();
    return {
      childList: records.filter(record => record.type === 'childList').length,
      reversed: [...island.querySelectorAll('li')].map(li => served.indexOf(li)),
      nested: [...nested.querySelectorAll('b')].map(b => bold.indexOf(b)),
    };
  });
  expect(moved.childList).toBeGreaterThan(0);
  expect(moved.reversed).toEqual([2, 1, 0]);
  expect(moved.nested).toEqual([1, 0, 2]);
  expect(errors).toEqual([]);
});

test('keyed registered children keep their own host, state and occurrence when their rows bind out of order and later move', async ({ page }) => {
  const CARD = 'fedcba9876543210';
  const card = (occurrence: number, key: string, count: number) =>
    `<!--f:i1--><button data-forma-island="1" data-forma-component="Card" data-forma-state="${occurrence}" data-forma-h="${CARD}" data-forma-key="${key}"><!--f:t0-->${count}<!--/f:t0--></button><!--/f:i1-->`;
  await serve(page,
    `<div data-forma-island="0" data-forma-component="Board" data-forma-state="0" data-forma-h="${H}"><ul><!--f:l0-->${card(1, '1', 10)}${card(2, '2', 20)}<!--/f:l0--></ul></div>`,
    [{ h: H, p: {} }, { h: CARD, p: { count: 10 } }, { h: CARD, p: { count: 20 } }]);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`uncaught: ${error.message}`));
  const result = await page.evaluate(async () => {
    const { h, activateIslands, __islandRegistration, createList, createSignal, onError } = await import('/adoption-core.mjs' as string);
    const codes: string[] = [];
    onError((error: { code?: string; message?: string }) => codes.push(String(error.code ?? error.message)));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    // The parent renders the registered component itself, as compiled code does; the
    // registration is what activation runs for each served Card host.
    const CardComponent = (props: { count: number }) => {
      const [count, setCount] = createSignal(props.count);
      return h('button', { onClick: () => setCount(count() + 1) }, () => String(count()));
    };
    const Card = __islandRegistration(CardComponent, { h: 'fedcba9876543210', schema: [[{ name: 'count', type: { kind: 'number' } }]], mode: 0 });
    // The client lists the cards in the other order: each binds the host whose key it has.
    const [cards, setCards] = createSignal([{ id: 2, count: 20 }, { id: 1, count: 10 }]);
    (window as any).setCards = setCards;
    const Board = __islandRegistration(() => h('div', null, h('ul', null,
      createList(cards, (item: { id: number }) => item.id, (item: { count: number }) => h(CardComponent, { count: item.count })))),
    { h: '0123456789abcdef', schema: [[]], mode: 0 });
    await activateIslands({ Board, Card });
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    observer.disconnect();
    return { codes, records: records.length };
  });
  expect(result).toEqual({ codes: [], records: 0 });
  const buttons = page.locator('button');
  await buttons.nth(0).click();
  await buttons.nth(1).click();
  await buttons.nth(1).click();
  await expect(buttons).toHaveText(['11', '22']);
  const identity = await page.evaluate(async () => {
    const before = [...document.querySelectorAll('button')];
    (window as any).setCards([{ id: 2, count: 20 }, { id: 1, count: 10 }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = [...document.querySelectorAll('button')];
    return {
      moved: after.map(button => before.indexOf(button)),
      states: after.map(button => [button.getAttribute('data-forma-key'), button.getAttribute('data-forma-state'), button.textContent]),
    };
  });
  // The rows moved into the client's order; each host kept its key, its served occurrence and its count.
  expect(identity.moved).toEqual([1, 0]);
  expect(identity.states).toEqual([['2', '2', '22'], ['1', '1', '11']]);
  await buttons.nth(0).click();
  await expect(buttons).toHaveText(['23', '11']);
  expect(errors).toEqual([]);
});

// Checkpoint D: identity alone is insufficient. Removing and reinserting an existing node can
// keep its JS identity while losing browser focus, selection, or the row's listener ownership.
for (const forceFallback of [false, true]) test(`one moved row in 2000 retains its focused input, selection and listeners without rebuilding (${forceFallback ? 'insertBefore fallback' : 'native move when available'})`, async ({ page }) => {
  const count = 2000;
  const markup = Array.from({ length: count }, (_, id) =>
    `<li data-forma-key="${id}"><input value="row-${id}"><button>Count</button></li>`).join('');
  await serve(page, `<div id="focused-list"><ul><!--f:l0-->${markup}<!--/f:l0--></ul></div>`);
  const initial = await page.evaluate(async ({ count, forceFallback }) => {
    const { h, createList, createSignal } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const values = Array.from({ length: count }, (_, id) => ({ id, text: `row-${id}` }));
    const [items, setItems] = createSignal(values);
    const observed: MutationRecord[] = [], clicks: number[] = [], edits: [number, string][] = [];
    const observer = new MutationObserver(batch => observed.push(...batch));
    const root = document.querySelector('#focused-list')!;
    if (forceFallback) Object.defineProperty(root.firstElementChild, 'moveBefore', { value: undefined });
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    const rows = [...root.querySelectorAll('li')], input = rows[0]!.querySelector('input')!;
    input.focus(); input.setSelectionRange(1, 4, 'backward');
    let factories = 0;
    const dispose = adoptMatching(() => h('ul', null, createList(items,
      (item: { id: number }) => item.id,
      (item: { id: number; text: string }) => {
        factories++;
        return h('li', null,
          h('input', { value: item.text, onInput: (event: Event) => edits.push([item.id, (event.target as HTMLInputElement).value]) }),
          h('button', { onClick: () => clicks.push(item.id) }, 'Count'));
      })), root);
    await new Promise(resolve => setTimeout(resolve, 0));
    observed.push(...observer.takeRecords());
    const records = observed.length; observed.length = 0;
    Object.assign(window as any, { keyedMove: { values, setItems, root, rows, input, observed, observer, clicks, edits, dispose, factories: () => factories } });
    return { records, focused: document.activeElement === input, selection: [input.selectionStart, input.selectionEnd, input.selectionDirection], factories };
  }, { count, forceFallback });
  expect(initial).toEqual({ records: 0, focused: true, selection: [1, 4, 'backward'], factories: count });

  // Programmatic source update leaves focus alone; a click on a reorder button would hide a
  // browser focus-loss bug by focusing that button before the list actually moved.
  const moved = await page.evaluate(async () => {
    const state = (window as any).keyedMove;
    state.setItems([...state.values.slice(1), state.values[0]]);
    await new Promise(resolve => setTimeout(resolve, 0));
    state.observed.push(...state.observer.takeRecords());
    const rows = [...state.root.querySelectorAll('li')];
    const mutations = state.observed as MutationRecord[];
    const touched = mutations.flatMap(record => [...record.addedNodes, ...record.removedNodes]);
    state.observer.disconnect();
    return {
      order: rows.every((row, index) => row === state.rows[(index + 1) % state.rows.length]),
      records: mutations.length,
      childListsOnly: mutations.every(record => record.type === 'childList'),
      touched: touched.length,
      onlyMovedRow: touched.every(node => node === state.rows[0]),
      focused: document.activeElement === state.input,
      selection: [state.input.selectionStart, state.input.selectionEnd, state.input.selectionDirection],
      factories: state.factories(),
    };
  });
  expect(moved).toEqual({ order: true, records: 2, childListsOnly: true, touched: 2, onlyMovedRow: true,
    focused: true, selection: [1, 4, 'backward'], factories: count });

  await page.keyboard.insertText('Z');
  await page.locator('#focused-list li').last().locator('button').click();
  const ownership = await page.evaluate(() => {
    const state = (window as any).keyedMove;
    const before = { clicks: [...state.clicks], edits: [...state.edits] };
    state.dispose();
    state.input.dispatchEvent(new Event('input', { bubbles: true }));
    state.rows[0].querySelector('button').click();
    return { before, after: { clicks: state.clicks, edits: state.edits } };
  });
  expect(ownership.before).toEqual({ clicks: [0], edits: [[0, 'rZ0']] });
  expect(ownership.after).toEqual(ownership.before);
});


test('fallback restoration respects a focus callback that chooses another control', async ({ page }) => {
  await serve(page, '<input id="elsewhere"><div id="focus-callback"><ul><!--f:l0--><li data-forma-key="a"><input value="a"></li><li data-forma-key="b"><input value="b"></li><li data-forma-key="c"><input value="c"></li><!--/f:l0--></ul></div>');
  const result = await page.evaluate(async () => {
    const { h, createList, createSignal } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const elsewhere = document.querySelector<HTMLInputElement>('#elsewhere')!;
    const root = document.querySelector('#focus-callback')!;
    Object.defineProperty(root.firstElementChild, 'moveBefore', { value: undefined });
    const [items, setItems] = createSignal(['a', 'b', 'c']);
    let activated = false;
    const events: string[] = [];
    const dispose = adoptMatching(() => h('ul', null, createList(items, (id: string) => id,
      (id: string) => h('li', null, h('input', { value: id, onFocus: () => {
        if (activated && id === 'a') { events.push('row focus'); elsewhere.focus(); }
      }, onBlur: () => {
        if (activated && id === 'a') { events.push('row blur'); elsewhere.focus(); }
      } })))), root);
    const input = root.querySelector('input')!;
    input.focus(); input.setSelectionRange(0, 1);
    activated = true;
    setItems(['b', 'c', 'a']);
    await new Promise(resolve => setTimeout(resolve, 0));
    const focused = document.activeElement === elsewhere;
    dispose();
    return { focused, events, rowMoved: root.querySelector('li:last-child input') === input };
  });
  expect(result).toMatchObject({ focused: true, rowMoved: true });
  expect(result.events.length).toBeGreaterThan(0);
});
