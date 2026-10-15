import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveOwnedAdoption } from './helpers/owned-adoption.js';

// FORMA-182's value rules in the real engines (docs/parity-rules.md). For each
// shared vector that reaches the DOM, the page serves the HTML the walker
// writes for it (forma-ir's `value_rule_vectors` asserts those bytes), the
// engine parses it, and strict adoption of the h() descriptor the compiled
// page would build over that DOM succeeds with zero MutationRecords and every
// served node retained. Rule 4 never reaches the DOM from the server (a date
// is a number; formatting it is a build error), so it has no section here.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

function vectors<T>(name: string): T {
  return JSON.parse(readFileSync(
    fileURLToPath(new URL(`../../../crates/forma-ir/tests/fixtures/parity/${name}`, import.meta.url)), 'utf8',
  )) as T;
}

/** A DYN_TEXT range as the walker writes it: an empty value is held by one U+200B. */
const range = (id: number, text: string): string => `<!--f:t${id}-->${text === '' ? '​' : text}<!--/f:t${id}-->`;

/** A value as it crosses into the page: JSON has no undefined and no lexeme-exact number. */
type Wire = { s: string } | { n: string } | { b: boolean } | { absent: 'null' | 'undefined' };

/** What adoption builds: one element, its props and its children, each static or a getter. */
interface Build { tag: string; props?: Record<string, Wire>; children?: Wire[]; reactive: boolean }

async function serve(page: Page, body: string): Promise<void> {
  await serveOwnedAdoption(page, '/adoption-core.mjs');
  await page.route('**/adoption-core.mjs', route => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript',
  }));
  // U+200B holds an empty range, so the document must say it is UTF-8.
  await page.route('**/value-rules.html', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Value rules</title></head><body><div id="app" data-forma-ssr>${body}</div></body></html>`,
  }));
  await page.goto('/value-rules.html');
}

/** Adopt `build` over the served #app; report its HTML and text before and after, the writes and whether every node was kept. */
function adopt(page: Page, build: Build) {
  return page.evaluate(async (build) => {
    const { h, Fragment } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const value = (wire: Wire): unknown => 's' in wire ? wire.s : 'n' in wire ? Number(wire.n) : 'b' in wire ? wire.b
      : wire.absent === 'null' ? null : undefined;
    const bind = (wire: Wire): unknown => (build.reactive ? () => value(wire) : value(wire));
    const app = document.querySelector('#app')!;
    const nodes = (): Node[] => {
      const all: Node[] = [], walker = document.createTreeWalker(app);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) all.push(node);
      return all;
    };
    const html = app.innerHTML, text = app.textContent!.replace(/​/g, ''), served = nodes();
    const records: string[] = [];
    const observer = new MutationObserver(batch => batch.forEach(record => records.push(record.type)));
    observer.observe(app, { subtree: true, childList: true, characterData: true, attributes: true });
    const props = build.props ? Object.fromEntries(Object.entries(build.props).map(([key, wire]) => [key, bind(wire)])) : null;
    adoptMatching(() => h(Fragment, null, h(build.tag, props, ...(build.children ?? []).map(bind))), '#app');
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords().map(record => record.type));
    observer.disconnect();
    const after = nodes();
    return {
      text, records, unchanged: app.innerHTML === html,
      retained: after.length === served.length && served.every((node, i) => after[i] === node),
    };
  }, build);
}

const written = { records: [], unchanged: true, retained: true };

// -- Rule 2: numbers in ECMAScript formatting ---------------------------------
interface NumberVector { id: string; lexeme: string; expected: string }
for (const { id, lexeme, expected } of vectors<{ values: NumberVector[] }>('numbers.json').values) {
  for (const reactive of [false, true]) {
    test(`rule 2 ${id} (${reactive ? 'reactive' : 'static'}): the served text parses to ${expected} and adopts the number without a write`, async ({ page }) => {
      await serve(page, `<p>${range(0, expected)}</p>`);
      expect(await adopt(page, { tag: 'p', children: [{ n: lexeme }], reactive })).toEqual({ text: expected, ...written });
    });
  }
  test(`rule 2 ${id}: the served attribute adopts the number without a write`, async ({ page }) => {
    await serve(page, `<span id="ok" title="${expected}"></span>`);
    expect(await adopt(page, { tag: 'span', props: { id: { s: 'ok' }, title: { n: lexeme } }, reactive: true }))
      .toEqual({ text: '', ...written });
  });
}

// -- Rule 3: integers within plus or minus (2^53 - 1) -------------------------
interface IntegerVector { id: string; lexeme: string; admitted: boolean }
interface FloatOriginVector { id: string; lexeme: string; expected: string }
const integers = vectors<{ exact: IntegerVector[]; floatOrigin: FloatOriginVector[] }>('integers.json');
for (const { id, lexeme } of integers.exact.filter(vector => vector.admitted)) {
  test(`rule 3 ${id}: an admitted integer's digits adopt the number the envelope carries without a write`, async ({ page }) => {
    await serve(page, `<p>${range(0, lexeme)}</p>`);
    expect(await adopt(page, { tag: 'p', children: [{ n: lexeme }], reactive: true })).toEqual({ text: lexeme, ...written });
  });
}
for (const { id, lexeme, expected } of integers.floatOrigin) {
  test(`rule 3 ${id}: a float origin is written by rule 2 and adopts without a write`, async ({ page }) => {
    await serve(page, `<p>${range(0, expected)}</p>`);
    expect(await adopt(page, { tag: 'p', children: [{ n: lexeme }], reactive: true })).toEqual({ text: expected, ...written });
  });
}

test('rule 2 control: a server spelling 1e21 as Rust\'s Display does (22 digits) is refused, not repaired', async ({ page }) => {
  // What `format!("{}", 1e21_f64)` writes; String(1e21) is "1e+21", so strict
  // adoption refuses the range instead of silently rewriting it.
  await serve(page, `<p>${range(0, '1000000000000000000000')}</p>`);
  const kept = await page.evaluate(async () => {
    const { h, Fragment } = await import('/adoption-core.mjs' as string);
    const { adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    adoptRefused(() => h(Fragment, null, h('p', null, () => 1e21)), '#app', 'FORMA_E_HYDRATE_VALUE');
    return document.querySelector('p')!.textContent;
  });
  expect(kept).toBe('1000000000000000000000');
});

// -- Rule 5: null writes nothing ------------------------------------------------
interface NullChildrenVector { id: string; children: (string | number | null)[]; expected: string }
interface NullAttributeVector { id: string; attribute: string }
const nulls = vectors<{ children: NullChildrenVector[]; attribute: NullAttributeVector[] }>('null.json');
const absentAs = ['null', 'undefined'] as const;
const wire = (value: string | number | null, absent: 'null' | 'undefined'): Wire =>
  value === null ? { absent } : typeof value === 'number' ? { n: String(value) } : { s: value };
for (const { id, children, expected } of nulls.children) {
  for (const absent of absentAs) {
    test(`rule 5 ${id} (${absent}, reactive): each child in its own range, the absent one held empty, adopts without a write`, async ({ page }) => {
      const ranges = children.map((child, i) => range(i, child === null ? '' : String(child))).join('');
      await serve(page, `<p>${ranges}</p>`);
      expect(await adopt(page, { tag: 'p', children: children.map(child => wire(child, absent)), reactive: true }))
        .toEqual({ text: expected, ...written });
    });
    test(`rule 5 ${id} (${absent}, static): the composed text, with nothing for the absent child, adopts without a write`, async ({ page }) => {
      await serve(page, `<p>${expected}</p>`);
      expect(await adopt(page, { tag: 'p', children: children.map(child => wire(child, absent)), reactive: false }))
        .toEqual({ text: expected, ...written });
    });
    test(`rule 5 ${id} (${absent}): a textarea composes the same value and adopts without a write`, async ({ page }) => {
      await serve(page, `<textarea>${expected}</textarea>`);
      expect(await adopt(page, { tag: 'textarea', children: children.map(child => wire(child, absent)), reactive: false }))
        .toEqual({ text: expected, ...written });
    });
  }
}
for (const { id, attribute } of nulls.attribute) {
  for (const absent of absentAs) {
    for (const reactive of [false, true]) {
      test(`rule 5 ${id} (${absent}, ${reactive ? 'reactive' : 'static'}): the omitted attribute adopts without a write`, async ({ page }) => {
        await serve(page, '<span id="ok"></span>');
        expect(await adopt(page, { tag: 'span', props: { id: { s: 'ok' }, [attribute]: { absent } }, reactive }))
          .toEqual({ text: '', ...written });
      });
    }
  }
}
for (const { id, attribute } of nulls.attribute) {
  test(`rule 5 ${id}: a later null or undefined removes the attribute, on an adopted element and on a fresh h() element`, async ({ page }) => {
    await serve(page, `<span id="ok" ${attribute}="x"></span>`);
    const seen = await page.evaluate(async (attribute) => {
      const { h, Fragment, createSignal } = await import('/adoption-core.mjs' as string);
      const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
      const [value, setValue] = createSignal('x');
      adoptMatching(() => h(Fragment, null, h('span', { id: 'ok', [attribute]: value })), '#app');
      const adopted = document.querySelector('#ok')!, fresh = h('span', { [attribute]: value }) as Element;
      const states: (string | null)[] = [];
      for (const next of [null, 'y', undefined, 'z']) {
        setValue(next);
        states.push(adopted.getAttribute(attribute), fresh.getAttribute(attribute));
      }
      return states;
    }, attribute);
    expect(seen).toEqual([null, null, 'y', 'y', null, null, 'z', 'z']);
  });
}
