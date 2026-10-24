import { test, expect } from '@playwright/test';

test('a refused computed keeps state writes visible while distinct and nested derived names work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/runtime-bare.html');
  const diagnostics = await page.evaluate(() => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.appendChild(root);
    rt.mountMarkup(root, rt.trustedHtml(`<section data-forma-state='{"count":2,"events":0}' data-on:probe="{events++}">
      <p id="before" data-text="{count}"></p>
      <i id="same" data-computed="count = $dispatch('probe'); doubled = count * 2" data-text="{count}"></i>
      <p id="after" data-text="{count}"></p><p id="derived" data-text="{doubled}"></p>
      <p id="events" data-text="{events}"></p><button id="inc" data-on:click="{count++}">+</button>
      <article data-forma-state='{"base":3}'><i data-computed="count = base * 2"></i>
        <p id="inner" data-text="{count}"></p><button id="inner-inc" data-on:click="{base++}">+</button>
      </article></section>`), { tier: 'reviewed' });
    return rt.getDiagnostics().map((d: { code: string; reason: string }) => [d.code, d.reason]);
  });
  expect(diagnostics).toEqual([['FORMA_E_UNSUPPORTED', 'computed "count" conflicts with a state key']]);
  await expect(page.locator('#same')).toHaveAttribute('data-forma-expr-error', 'unsupported');
  for (const id of ['before', 'same', 'after']) await expect(page.locator(`#${id}`)).toHaveText('2');
  await expect(page.locator('#derived')).toHaveText('4');
  await expect(page.locator('#inner')).toHaveText('6');
  await expect(page.locator('#events')).toHaveText('0');
  await page.click('#inc');
  await page.click('#inner-inc');
  for (const id of ['before', 'same', 'after']) await expect(page.locator(`#${id}`)).toHaveText('3');
  await expect(page.locator('#derived')).toHaveText('6');
  await expect(page.locator('#inner')).toHaveText('8');
  await expect(page.locator('#events')).toHaveText('0');
  expect(errors).toEqual([]);
});
