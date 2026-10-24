import { test, expect, type Page } from '@playwright/test';

/**
 * FORMA-283 in a real engine, with the built CDN runtime: a `data-forma-state`
 * scope nested in another was also bound by the outer scope, so an outer write
 * overwrote the inner scope's text, a name only the inner scope declares was
 * reported FORMA_E_UNRESOLVED, and a trusted click ran the inner handler and
 * the outer one. Each scope now binds only its own elements.
 */
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

const INNER = `<article id="i" data-forma-state='{"msg":"inner","only":"io","n":0}'>
  <span id="t" data-text="{msg}"></span><i id="only" data-text="{only}"></i>
  <button id="b" data-on:click="{n++}">b</button><b id="n" data-text="{n}"></b>
</article>`;

async function mount(page: Page, html: string): Promise<string[]> {
  return page.evaluate((html) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    (window as unknown as { handle: unknown }).handle = rt.mountMarkup(root, rt.trustedHtml(html), { tier: 'reviewed' });
    return (rt.getDiagnostics() as Array<{ code: string }>).map((d) => d.code);
  }, html);
}

const diagnostics = (page: Page): Promise<string[]> => page.evaluate(() =>
  ((window as unknown as { FormaRuntime: any }).FormaRuntime.getDiagnostics() as Array<{ code: string; expr: string }>)
    .map((d) => `${d.code} ${d.expr}`));

function n(page: Page, selector: string): Promise<unknown> {
  return page.evaluate((selector) =>
    (document.querySelector(selector) as unknown as { __formaScope: { getters: { n(): unknown } } }).__formaScope.getters.n(), selector);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/runtime-bare.html');
});

test('the inner scope binds its elements once: an outer write leaves them, and a trusted click runs one handler', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  expect(await mount(page, `<section id="o" data-forma-state='{"msg":"outer","n":100}'>
    <p id="before" data-text="{msg}"></p>${INNER}<p id="after" data-text="{msg}"></p>
    <button id="write" data-on:click="{msg = 'outer2'}">write</button></section>`)).toEqual([]);
  await expect(page.locator('#t')).toHaveText('inner');
  await expect(page.locator('#only')).toHaveText('io');
  await page.click('#write');
  await expect(page.locator('#before')).toHaveText('outer2');
  await expect(page.locator('#after')).toHaveText('outer2');
  await expect(page.locator('#t')).toHaveText('inner');
  await page.click('#b');
  await expect(page.locator('#n')).toHaveText('1');
  expect([await n(page, '#i'), await n(page, '#o')]).toEqual([1, 100]);
  expect(await diagnostics(page)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const on of [false, true]) {
  test(`a scope nested in a data-if that is ${on} at mount is bound once, by its own scope`, async ({ page }) => {
    expect(await mount(page, `<section id="o" data-forma-state='{"on":${on},"msg":"outer","n":100}'>
      <button id="toggle" data-on:click="{on = !on}">toggle</button>
      <button id="write" data-on:click="{msg = 'outer2'}">write</button>
      <div data-if="{on}">${INNER}</div></section>`)).toEqual([]);
    if (!on) await page.click('#toggle');
    await page.click('#write');
    await expect(page.locator('#t')).toHaveText('inner');
    await page.click('#b');
    await page.click('#toggle');
    await page.click('#toggle');
    await page.click('#b');
    await expect(page.locator('#n')).toHaveText('2');
    expect(await n(page, '#o')).toBe(100);
    expect(await diagnostics(page)).toEqual([]);
  });
}

test('an update that changes the outer scope mounts the nested scope again, once, and disposes the old one', async ({ page }) => {
  const outer = (state: string) => `<section id="o" data-forma-state='{${state}}'><p id="before" data-text="{msg}"></p>${INNER}</section>`;
  await mount(page, outer('"msg":"outer","n":100'));
  const old = await page.evaluate((html) => {
    const w = window as unknown as { FormaRuntime: any; handle: { update(h: unknown): void } };
    const oldButton = document.getElementById('b')!;
    const oldScope = (document.getElementById('i') as unknown as { __formaScope: { getters: { n(): unknown } } }).__formaScope;
    w.handle.update(w.FormaRuntime.trustedHtml(html));
    oldButton.click();
    return { replaced: document.getElementById('b') !== oldButton, oldN: oldScope.getters.n() };
  }, outer('"msg":"outer","n":100,"extra":1'));
  // The old inner scope is disposed: its button, out of the document, no longer counts.
  expect(old).toEqual({ replaced: true, oldN: 0 });
  await expect(page.locator('#t')).toHaveText('inner');
  await expect(page.locator('#n')).toHaveText('0');
  await page.click('#b');
  await expect(page.locator('#n')).toHaveText('1');
  expect([await n(page, '#i'), await n(page, '#o')]).toEqual([1, 100]);
  expect(await diagnostics(page)).toEqual([]);
});
