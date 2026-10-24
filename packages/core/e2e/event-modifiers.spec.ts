import { test, expect, type Page } from '@playwright/test';

/**
 * FORMA-269 in a real engine: `data-on:click.stop=""` on a modal box inside a backdrop
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

test('a refused data-on:submit.prevent prevents nothing: the form still submits, as before FORMA-269; the rewrite does not', async ({ page }) => {
  // Refusing the name does not perform the modifier: what is new is the diagnostic.
  const form = (handler: string): Promise<Array<[string, string]>> => page.evaluate((handler) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{"sent": false}'>
      <form ${handler}><input name="q" value="secret"><button id="go">go</button></form>
      <p id="sent" data-text="{sent}"></p>
    </div>`), { tier: 'reviewed' });
    return (rt.getDiagnostics() as Array<{ code: string; expr: string }>).map((d) => [d.code, d.expr] as [string, string]);
  }, handler);

  expect(await form('data-on:submit="{$event.preventDefault(); sent = true}"')).toEqual([]);
  await page.click('#go');
  await expect(page.locator('#sent')).toHaveText('true');
  expect(new URL(page.url()).search).toBe('');

  expect(await form('data-on:submit.prevent="{sent = true}"'))
    .toEqual([['FORMA_E_UNSUPPORTED', 'data-on:submit.prevent="{sent = true}"']]);
  await Promise.all([page.waitForURL(/\?q=secret$/), page.click('#go')]);
});

test("Svelte's data-on:click|preventDefault stays one attribute, never runs on a click, and reports nothing", async ({ page }) => {
  const outcome = await page.evaluate(() => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{"n": 0}'>
      <button id="b" data-on:click|preventDefault="{n++}">b</button><p id="n" data-text="{n}"></p>
    </div>`), { tier: 'reviewed' });
    const button = root.querySelector('#b') as HTMLElement;
    button.click();
    return { names: button.getAttributeNames(), n: root.querySelector('#n')!.textContent, codes: rt.getDiagnostics().length };
  });

  expect(outcome).toEqual({ names: ['id', 'data-on:click|preventdefault'], n: '0', codes: 0 });
});

test('the rewrite the diagnostic names, $event.stopPropagation(), keeps the box open under a trusted click', async ({ page }) => {
  const outcome = await mount(page, 'data-on:click="{$event.stopPropagation()}"');

  expect(outcome).toEqual({ codes: [], marked: [] });
  await page.click('#box');
  await expect(page.locator('#state')).toHaveText('true');
  await page.click('#backdrop', { position: { x: 5, y: 5 } });
  await expect(page.locator('#state')).toHaveText('false');
});
