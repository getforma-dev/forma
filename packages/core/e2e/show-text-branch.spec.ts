import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveOwnedAdoption } from './helpers/owned-adoption.js';

// FORMA-016 F5 in the real engines: the bytes the walker writes for a
// conditional whose branch is text (the shared show-text-branch.json vectors,
// also read by forma-ir's walker tests and core's unit suite) are parsed by the
// browser and strictly adopted with createShow(cond, () => value) with no
// mutation record and the server's Text node kept; a client-rendered scalar
// branch is a Text node and does not throw.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

interface Vector { id: string; value: string | number | boolean | null; text: string; nothing?: boolean; clientOnly?: boolean; html?: string }
const vectors = (JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../crates/forma-ir/tests/fixtures/parity/show-text-branch.json', import.meta.url)), 'utf8',
)) as { values: Vector[] }).values;

async function serve(page: Page, body: string): Promise<void> {
  await serveOwnedAdoption(page, '/adoption-core.mjs');
  await page.route('**/adoption-core.mjs', route => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript',
  }));
  await page.route('**/show-text.html', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Show text</title></head><body><div id="app" data-forma-ssr><section>${body}</section></div></body></html>`,
  }));
  await page.goto('/show-text.html');
}

for (const vector of vectors.filter(v => !v.clientOnly && !v.nothing)) {
  test(`served text branch ${vector.id}: createShow adopts it without a write, keeps the server text node, then toggles`, async ({ page }) => {
    await serve(page, `<!--f:s0-->${vector.html}<!--/f:s0-->`);
    const result = await page.evaluate(async (value) => {
      const { h, createShow, createSignal } = await import('/adoption-core.mjs' as string);
      const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
      const section = document.querySelector('section')!;
      const visible = () => (section.textContent ?? '').replace(/​/g, '');
      const before = visible(), text = [...section.childNodes].find(n => n.nodeType === 3)!;
      const records: string[] = [];
      const observer = new MutationObserver(batch => batch.forEach(record => records.push(record.type)));
      observer.observe(section, { subtree: true, childList: true, characterData: true, attributes: true });
      const [on, setOn] = createSignal(true);
      adoptMatching(() => h('section', null, createShow(on, () => value, () => h('i', null, 'no'))), '#app');
      await new Promise(resolve => setTimeout(resolve, 0));
      records.push(...observer.takeRecords().map(record => record.type));
      observer.disconnect();
      const kept = [...section.childNodes].includes(text);
      setOn(false);
      const off = section.querySelector('i')?.textContent;
      setOn(true);
      return { before, after: visible(), records, kept, off, back: visible() };
    }, vector.value);
    expect(result).toEqual({ before: vector.text, after: vector.text, records: [], kept: true, off: 'no', back: vector.text });
  });
}

test('a client-rendered scalar branch is a Text node (it threw on insertBefore before F5), and null, a boolean write nothing', async ({ page }) => {
  await serve(page, '');
  const result = await page.evaluate(async () => {
    const { createShow, createSwitch, createSignal } = await import('/adoption-core.mjs' as string);
    const host = document.createElement('div');
    const [which, setWhich] = createSignal('s');
    host.append(createShow(() => true, () => 'Title'), createShow(() => true, () => 7), createShow(() => true, () => null), createShow(() => true, () => true),
      createSwitch(which, [{ match: 's', render: () => 'S' }, { match: 'n', render: () => 5 }, { match: 'x', render: () => null }]));
    const first = host.textContent;
    setWhich('n'); const second = host.textContent;
    setWhich('x'); const third = host.textContent;
    return { first, second, third, textNodes: [...host.childNodes].filter(n => n.nodeType === 3).length };
  });
  expect(result).toEqual({ first: 'Title7S', second: 'Title75', third: 'Title7', textNodes: 2 });
});
