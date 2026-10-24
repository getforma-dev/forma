import { test, expect, type Page } from '@playwright/test';

/**
 * A mount's `update()` in a real browser, on the production CDN build
 * (FORMA-277): what happy-dom cannot show. The new markup is parsed and held
 * in a document with no browsing context, so a copy the diff only reads loads
 * nothing and runs no handler; only what the diff writes is adopted into the
 * page. And an SVG animation value with a script URL is not written by any
 * sink, so the animated `href` never becomes one.
 */

type Handle = { update(markup: unknown): void; unmount(): void };
type Runtime = {
  trustedHtml(markup: string): unknown;
  mountMarkup(root: Element, markup: unknown, options: unknown): Handle;
};
type Win = Window & { FormaRuntime: Runtime; handle: Handle; fired: number; upgraded: number; connected: number };

async function bare(page: Page): Promise<void> {
  await page.goto('/runtime-bare.html');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="root"></div>');
    (window as unknown as Win).fired = 0;
  });
}

const mount = (page: Page, markup: string) => page.evaluate((m) => {
  const w = window as unknown as Win;
  w.handle = w.FormaRuntime.mountMarkup(document.getElementById('root')!, w.FormaRuntime.trustedHtml(m), { tier: 'reviewed', grants: {} });
}, markup);

const update = (page: Page, markup: string) => page.evaluate((m) => {
  const w = window as unknown as Win;
  w.handle.update(w.FormaRuntime.trustedHtml(m));
}, markup);

test("an update's parsed copy of a kept <img> loads nothing and runs no handler: only what the diff writes reaches the page", async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/f277/**', (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, body: '' });
  });
  await bare(page);
  await mount(page, `<div data-forma-state='{}'><img id="kept" src="/f277/kept.png" alt="one"><p id="p">one</p></div>`);
  await expect.poll(() => requests).toEqual(['/f277/kept.png']);
  await page.waitForFunction(() => (document.getElementById('kept') as HTMLImageElement).complete);

  // The update keeps the <img> and adds onerror, which the diff does not
  // write to an element it keeps. The control image is new, so the diff
  // writes it and the page loads it.
  await update(page, `<div data-forma-state='{}'><img id="kept" src="/f277/kept.png" alt="two" onerror="window.fired++">` +
    `<img id="control" src="/f277/control.png"><p id="p">two</p></div>`);
  await expect(page.locator('#p')).toHaveText('two');
  await expect.poll(() => requests).toContain('/f277/control.png');
  await page.waitForFunction(() => (document.getElementById('control') as HTMLImageElement).complete);
  await page.evaluate(() => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve, 50)), 50)));

  expect(await page.locator('#kept').getAttribute('alt')).toBe('two');
  expect(await page.locator('#kept').getAttribute('onerror')).toBeNull();
  const fired = await page.evaluate(() => (window as unknown as Win).fired);
  expect({ requests, fired }).toEqual({ requests: ['/f277/kept.png', '/f277/control.png'], fired: 0 });
});

test('every update path adopts the parsed nodes into the page: kept, added, RESET, REPLACE, full replacement, and a custom element upgraded when added', async ({ page }) => {
  await bare(page);
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.upgraded = 0;
    w.connected = 0;
    customElements.define('x-f277', class extends HTMLElement {
      constructor() { super(); w.upgraded++; }
      connectedCallback() { w.connected++; this.setAttribute('data-up', String(this.ownerDocument === document)); }
    });
  });
  const scope = (id: string, module: string, state: string, inner: string) =>
    `<div data-forma-id="${id}" data-module="${module}" data-forma-state='${state}'>${inner}</div>`;
  await mount(page,
    scope('keep', 'm', '{"n":1}', '<p id="keep-n" data-text="{n}">-</p><button id="inc" data-on:click="{n++}">+</button>') +
    scope('reset', 'm', '{"a":1}', '<p id="reset-v" data-text="{a}">-</p>') +
    scope('replace', 'm', '{"r":1}', '<p id="replace-v" data-text="{r}">-</p>'));
  await expect(page.locator('#keep-n')).toHaveText('1');
  await page.locator('#inc').click();
  await expect(page.locator('#keep-n')).toHaveText('2');
  const kept = await page.evaluateHandle(() => document.getElementById('keep-n'));

  await update(page,
    scope('keep', 'm', '{"n":1}', '<p id="keep-n" data-text="{n}" title="patched">-</p><button id="inc" data-on:click="{n++}">+</button><x-f277 id="ce">c</x-f277>') +
    scope('reset', 'm', '{"b":5}', '<p id="reset-v" data-text="{b}">-</p>') +
    scope('replace', 'other', '{"r":7}', '<p id="replace-v" data-text="{r}">-</p>') +
    scope('added', 'm', '{"z":9}', '<p id="added-v" data-text="{z}">-</p>'));
  // Kept: same node, its state kept, the attribute patched.
  expect(await page.evaluate((el) => el === document.getElementById('keep-n'), kept)).toBe(true);
  await expect(page.locator('#keep-n')).toHaveText('2');
  await expect(page.locator('#keep-n')).toHaveAttribute('title', 'patched');
  await page.locator('#inc').click();
  await expect(page.locator('#keep-n')).toHaveText('3');
  await expect(page.locator('#reset-v')).toHaveText('5');
  await expect(page.locator('#replace-v')).toHaveText('7');
  await expect(page.locator('#added-v')).toHaveText('9');
  // The custom element the update added is upgraded in the page.
  await expect(page.locator('#ce')).toHaveAttribute('data-up', 'true');
  expect(await page.evaluate(() => {
    const w = window as unknown as Win;
    return [w.upgraded, w.connected, document.getElementById('ce') instanceof customElements.get('x-f277')!];
  })).toEqual([1, 1, true]);
  // Every element under the root is the page's.
  expect(await page.evaluate(() => Array.from(document.getElementById('root')!.querySelectorAll('*')).every((el) => el.ownerDocument === document))).toBe(true);

  // Full replacement: no data-forma-id shared with what is there.
  await update(page, scope('fresh', 'm', '{"f":4}', '<p id="fresh-v" data-text="{f}">-</p><x-f277 id="ce2">d</x-f277>'));
  await expect(page.locator('#fresh-v')).toHaveText('4');
  await expect(page.locator('#keep-n')).toHaveCount(0);
  await expect(page.locator('#ce2')).toHaveAttribute('data-up', 'true');
});

test('an SVG animation value with a script URL is not written by update(), data-bind: or a row attribute: the animated href stays an ordinary URL', async ({ page }) => {
  await bare(page);
  const animated = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#root svg a')).map((a) => [a.id, (a as SVGAElement).href.animVal]));
  const module = (keptTo: string, keptValues: string) => `<div data-forma-state='{"u":"javascript:void(0)","rows":[{"u":"javascript:void(0)"}]}'>` +
    `<svg><a id="kept"><text>k</text><set id="s1" attributeName="href" to="${keptTo}"></set></a>` +
    `<a id="kept2"><text>k2</text><animate id="a1" attributeName="href" values="${keptValues}" dur="1000s"></animate></a>` +
    `<a id="bound"><text>b</text><set attributeName="href" data-bind:to="{u}"></set></a></svg>` +
    `<div data-list="{rows}"><svg><a class="row" id="row"><text>r</text><set attributeName="href" to="{item.u}"></set></a></svg></div>` +
    `</div>`;
  await mount(page, module('#first', '#x;#y'));
  await expect.poll(animated).toEqual([['kept', '#first'], ['kept2', '#x'], ['bound', ''], ['row', '']]);
  // The update changes the kept elements' values to script URLs.
  await update(page, module('JaVaScRiPt:void(0)', 'javascript:void(0);#y'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => Array.from(document.querySelectorAll('#root set, #root animate'))
    .flatMap((el) => ['to', 'values'].map((n) => el.getAttribute(n)).filter((v) => v !== null)))).toEqual([]);
  // With its value removed, an animation applies none: the href shows its
  // last ordinary value or none, never the script URL.
  const after = await animated();
  expect(after.map(([id]) => id)).toEqual(['kept', 'kept2', 'bound', 'row']);
  for (const [id, value] of after) expect(value, id as string).not.toMatch(/script:/i);
});
