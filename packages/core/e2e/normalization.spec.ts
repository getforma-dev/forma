import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveOwnedAdoption } from './helpers/owned-adoption.js';

// FORMA-182 rule 1 in the real engines: the HTML the walker writes for the
// shared `textarea` and `pre` vectors is parsed by the browser (which drops
// the first line feed of those elements), the parsed value is the vector's
// `value`, and strict adoption of the same h() descriptor over that served
// DOM succeeds without a write. The vector file is the one forma-ir's and
// core's unit suites read.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

interface Vector { id: string; children: string[]; html: string; htmlDynamic?: string; value: string }
const vectors = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../crates/forma-ir/tests/fixtures/parity/normalization.json', import.meta.url)), 'utf8',
)) as { textarea: Vector[]; pre: Vector[] };

async function serve(page: Page, body: string): Promise<void> {
  await serveOwnedAdoption(page, '/adoption-core.mjs');
  await page.route('**/adoption-core.mjs', route => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript',
  }));
  // The vectors carry U+FFFD and U+200B, so the document must say it is
  // UTF-8; without it the engines decode the served bytes as windows-1252.
  await page.route('**/normalization.html', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Normalization</title></head><body><div id="app" data-forma-ssr>${body}</div></body></html>`,
  }));
  await page.goto('/normalization.html');
}

/** Parse the served HTML, adopt `tag` with `children` (reactive when `dynamic`), report the text before and after. */
function adopt(page: Page, tag: string, children: string[], dynamic: boolean) {
  return page.evaluate(async ([tag, children, dynamic]) => {
    const { h, Fragment } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const element = document.querySelector(tag)!;
    const text = () => tag === 'textarea'
      ? (element as HTMLTextAreaElement).value
      : (element.textContent ?? '').replace(/​/g, '');
    const before = text(), nodes = [...element.childNodes];
    const records: string[] = [];
    const observer = new MutationObserver(batch => batch.forEach(record => records.push(record.type)));
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    adoptMatching(() => h(Fragment, null, h(tag, null, ...(dynamic ? children.map(child => () => child) : children))), '#app');
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords().map(record => record.type));
    observer.disconnect();
    return { before, after: text(), records, retained: nodes.every((node, i) => element.childNodes[i] === node) };
  }, [tag, children, dynamic] as const);
}

for (const vector of vectors.textarea) {
  test(`textarea vector ${vector.id}: the engine parses the served HTML to the value h() writes, and adoption makes no write`, async ({ page }) => {
    await serve(page, vector.html);
    const result = await adopt(page, 'textarea', vector.children, false);
    expect(result).toEqual({ before: vector.value, after: vector.value, records: [], retained: true });
  });
}

for (const vector of vectors.pre) {
  test(`pre vector ${vector.id}: static HTML parses to the value and adopts without a write`, async ({ page }) => {
    await serve(page, vector.html);
    const result = await adopt(page, 'pre', vector.children, false);
    expect(result).toEqual({ before: vector.value, after: vector.value, records: [], retained: true });
  });
  test(`pre vector ${vector.id}: marker-separated dynamic HTML is not doubled and adopts without a write`, async ({ page }) => {
    await serve(page, vector.htmlDynamic!);
    const result = await adopt(page, 'pre', vector.children, true);
    expect(result).toEqual({ before: vector.value, after: vector.value, records: [], retained: true });
  });
}

test('control: the engine drops exactly one leading line feed in pre, so an undoubled server value disagrees', async ({ page }) => {
  // What checkpoint 2 still wrote for `h('pre', null, '\nline')`; strict
  // adoption refuses it, which is the disagreement the pre rule closes.
  await serve(page, '<pre>\nline</pre>');
  expect(await page.evaluate(() => document.querySelector('pre')!.textContent)).toBe('line');
  const refused = await page.evaluate(async () => {
    const { h, Fragment } = await import('/adoption-core.mjs' as string);
    const { adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    adoptRefused(() => h(Fragment, null, h('pre', null, '\nline')), '#app', 'FORMA_E_HYDRATE_VALUE');
    return document.querySelector('pre')!.textContent;
  });
  expect(refused).toBe('line');
});
