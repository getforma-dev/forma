import { test, expect, type Page } from '@playwright/test';

/**
 * FORMA-279 in a real engine, with the built CDN runtime: a `data-if` that is
 * false when its scope mounts left everything in its branch unbound, so after
 * the condition turned true the branch showed the markup as written and its
 * inputs and buttons did nothing. Each test mounts the same widget with the
 * branch false and with it true, and expects the same result.
 */
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

const WIDGET = (on: boolean): string => `<div data-forma-state='{"on": ${on}, "msg": "a", "n": 0, "hot": false, "inner": false, "v": "m", "items": ["x"]}'>
  <button id="toggle" data-on:click="{on = !on}">toggle</button>
  <div id="branch" data-if="{on}">
    <span id="text" data-text="{msg}">stale</span>
    <span id="show" data-show="{n > 0}">shown</span>
    <span id="cls" data-class:hot="{hot}">cls</span>
    <a id="bind" data-bind:title="{msg}">bind</a>
    <input id="model" data-model="{v}">
    <button id="inc" data-on:click="{n++}">inc</button>
    <span id="loud" data-computed="loud = msg + '!'" data-text="{loud}">stale</span>
    <p id="nested" data-if="{inner}">nested</p>
    <ul id="list" data-list="{items}"><li data-text="{item}">template</li></ul>
  </div>
  <output id="n" data-text="{n}"></output>
  <output id="v" data-text="{v}"></output>
  <output id="loud-after" data-text="{loud}">stale</output>
</div>`;

async function mount(page: Page, on: boolean): Promise<string[]> {
  return page.evaluate((html) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    (window as unknown as { handle: unknown }).handle = rt.mountMarkup(root, rt.trustedHtml(html), { tier: 'reviewed' });
    return (rt.getDiagnostics() as Array<{ code: string }>).map((d) => d.code);
  }, WIDGET(on));
}

function scope(page: Page, fn: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(([fn, args]) => {
    const s = (document.querySelector('[data-forma-state]') as unknown as { __formaScope: { setters: Record<string, (v: unknown) => void> } }).__formaScope;
    s.setters[fn as string]!(...(args as unknown[]));
    return null;
  }, [fn, args] as const);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/runtime-bare.html');
});

for (const on of [false, true]) {
  test(`a data-if that is ${on} at mount binds every directive in its branch, and they update once it shows`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    expect(await mount(page, on)).toEqual([]);
    if (!on) {
      await expect(page.locator('#branch')).toHaveCount(0);
      await page.click('#toggle');
    }
    await expect(page.locator('#text')).toHaveText('a');
    await expect(page.locator('#show')).toBeHidden();
    await expect(page.locator('#bind')).toHaveAttribute('title', 'a');
    await expect(page.locator('#model')).toHaveValue('m');
    await expect(page.locator('#loud')).toHaveText('a!');
    await expect(page.locator('#loud-after')).toHaveText('a!');
    await expect(page.locator('#nested')).toHaveCount(0);
    await expect(page.locator('#list li')).toHaveText(['x']);

    await page.click('#inc');
    await page.fill('#model', 'typed');
    await scope(page, 'msg', 'b');
    await scope(page, 'hot', true);
    await scope(page, 'inner', true);
    await scope(page, 'items', ['x', 'y']);
    await expect(page.locator('#n')).toHaveText('1');
    await expect(page.locator('#show')).toBeVisible();
    await expect(page.locator('#v')).toHaveText('typed');
    await expect(page.locator('#text')).toHaveText('b');
    await expect(page.locator('#cls')).toHaveClass('hot');
    await expect(page.locator('#bind')).toHaveAttribute('title', 'b');
    await expect(page.locator('#loud')).toHaveText('b!');
    await expect(page.locator('#loud-after')).toHaveText('b!');
    await expect(page.locator('#nested')).toHaveText('nested');
    await expect(page.locator('#list li')).toHaveText(['x', 'y']);
    expect(await page.evaluate(() => (window as unknown as { FormaRuntime: any }).FormaRuntime.getDiagnostics().length)).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`a data-if that is ${on} at mount, toggled 50 times, keeps one handler, and unmounting while hidden disposes it`, async ({ page }) => {
    await mount(page, on);
    for (let i = 0; i < 50; i++) await page.click('#toggle');
    if (!on) await page.click('#toggle');
    await page.click('#inc');
    await expect(page.locator('#n')).toHaveText('1');
    const after = await page.evaluate(() => {
      const s = (document.querySelector('[data-forma-state]') as unknown as {
        __formaScope: { getters: Record<string, () => unknown>; setters: Record<string, (v: unknown) => void> };
      }).__formaScope;
      const inc = document.getElementById('inc')!;
      const text = document.getElementById('text')!;
      document.getElementById('toggle')!.click();
      const hidden = document.getElementById('branch') === null;
      (window as unknown as { handle: { unmount(): void } }).handle.unmount();
      inc.click();
      s.setters.msg('after');
      return { hidden, n: s.getters.n(), text: text.textContent };
    });
    expect(after).toEqual({ hidden: true, n: 1, text: 'a' });
  });
}

test('a scope nested in a data-if that is false at mount mounts once the branch shows, as it does when the branch starts true', async ({ page }) => {
  const run = (on: boolean) => page.evaluate((on) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const handle = rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{"on": ${on}}'>
      <div data-if="{on}"><article data-forma-state='{"msg": "inner", "n": 0}'>
        <span id="t" data-text="{msg}">stale</span><button id="b" data-on:click="{n++}">+</button><b id="n" data-text="{n}">stale</b>
      </article></div></div>`), { tier: 'reviewed' });
    const outer = (root.firstElementChild as unknown as { __formaScope: { setters: { on(v: boolean): void } } }).__formaScope;
    outer.setters.on(true);
    const seen = [root.querySelector('#t')!.textContent, root.querySelector('#n')!.textContent];
    (root.querySelector('#b') as HTMLElement).click();
    seen.push(root.querySelector('#n')!.textContent);
    handle.unmount();
    return seen;
  }, on);
  expect(await run(false)).toEqual(['inner', '0', '1']);
  expect(await run(true)).toEqual(['inner', '0', '1']);
});
