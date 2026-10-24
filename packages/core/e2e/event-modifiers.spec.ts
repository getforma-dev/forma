import { test, expect, type Page } from '@playwright/test';

/**
 * FORMA-269 in a real engine, on the shape it was found in: forma-vector-studio's
 * folder-picker puts `data-on:click.stop=""` on a modal box inside a backdrop
 * that closes on click. `.stop` is Vue/Alpine syntax. The runtime listened for
 * an event named `click.stop`, so the box stopped nothing, and nothing said so.
 * Now the name is refused with a coded diagnostic, and the rewrite the message
 * names, `$event.stopPropagation()`, keeps the box open under a trusted click.
 */
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

interface Outcome { codes: Array<[string, string]>; marked: string[] }

async function mount(page: Page, box: string): Promise<Outcome> {
  return page.evaluate((box) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{"open": true}'>
      <div id="backdrop" style="padding: 40px" data-on:click="{open = false}">
        <div id="box" style="width: 100px; height: 40px" ${box}>box</div>
      </div>
      <p id="state" data-text="{open}"></p>
    </div>`), { tier: 'reviewed' });
    return {
      codes: (rt.getDiagnostics() as Array<{ code: string; expr: string }>).map((d) => [d.code, d.expr] as [string, string]),
      marked: [...root.querySelectorAll('[data-forma-handler-error]')].map((e) => e.id),
    };
  }, box);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/runtime-bare.html');
});

test('data-on:click.stop is refused with FORMA_E_UNSUPPORTED, and stops nothing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const outcome = await mount(page, 'data-on:click.stop=""');

  expect(outcome).toEqual({ codes: [['FORMA_E_UNSUPPORTED', 'data-on:click.stop=""']], marked: ['box'] });
  await page.click('#box');
  await expect(page.locator('#state')).toHaveText('false');
  expect(errors).toEqual([]);
});

test('the rewrite the diagnostic names, $event.stopPropagation(), keeps the box open under a trusted click', async ({ page }) => {
  const outcome = await mount(page, 'data-on:click="{$event.stopPropagation()}"');

  expect(outcome).toEqual({ codes: [], marked: [] });
  await page.click('#box');
  await expect(page.locator('#state')).toHaveText('true');
  await page.click('#backdrop', { position: { x: 5, y: 5 } });
  await expect(page.locator('#state')).toHaveText('false');
});
