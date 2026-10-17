import {test, expect, type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';

const H = '0123456789abcdef';
const mark = (id: number, name: string) => `data-forma-island="${id}" data-forma-state="${id}" data-forma-component="${name}" data-forma-h="${H}"`;
async function serve(page: Page, kind: 'root'|'descendant'|'nested') {
  const target = kind === 'root' ? `<button id="action" ${mark(1, 'Target')}>B</button>`
    : kind === 'descendant' ? `<div id="target" ${mark(1, 'Target')}><button id="action">B</button></div>`
    : `<div id="target" ${mark(1, 'Parent')}><!--f:i2--><button id="action" ${mark(2, 'Target')}>B</button><!--/f:i2--></div>`;
  const state = {v: 1, s: [], i: Array.from({length: kind === 'nested' ? 3 : 2}, () => ({h: H, p: {}}))};
  await page.route('**/load-core.mjs', route => route.fulfill({path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript'}));
  await page.route('**/load-queue.html', route => route.fulfill({contentType: 'text/html', headers: {'Content-Security-Policy': "default-src 'self'; script-src 'self'; object-src 'none'; require-trusted-types-for 'script'"}, body: `<!doctype html><html><head><script type="application/json" data-island-state>${JSON.stringify(state)}</script></head><body><div id="slow" ${mark(0, 'Slow')}>A</div>${target}</body></html>`}));
  await page.goto('/load-queue.html');
  return page.evaluate(async kind => {
    const {activateIslands, deactivateIsland, __islandRegistration, h, onError} = await import('/load-core.mjs' as string);
    const errors: string[] = [], order: string[] = [], events: {trusted: boolean; target: string}[] = [];
    let parentClicks = 0, time = 0;
    onError((error: any) => errors.push(error.code));
    const records: MutationRecord[] = [], observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(document.body, {subtree: true, attributes: true, characterData: true, childList: true});
    const button = document.getElementById('action')!, original = document.body.innerHTML;
    const click = (event: Event) => events.push({trusted: event.isTrusted, target: (event.target as Element).id});
    const metadata = {h: '0123456789abcdef', schema: [[]], mode: 0};
    const Target = () => { order.push('Target'); return kind === 'descendant' ? h('div', {id: 'target'}, h('button', {id: 'action', onClick: click}, 'B')) : h('button', {id: 'action', onClick: click}, 'B'); };
    const target = __islandRegistration(Target, metadata);
    const registry: Record<string, any> = {
      Slow: __islandRegistration(() => { order.push('Slow'); time = 13; return h('div', {id: 'slow'}, 'A'); }, metadata),
      Target: target,
    };
    if (kind === 'nested') registry.Parent = __islandRegistration(() => { order.push('Parent'); return h('div', {id: 'target', onClick: () => parentClicks++}, h(Target)); }, metadata);

    // Control only the scheduling gap, not DOM dispatch: real Playwright input
    // below reaches a demonstrably still-queued island. This is not a timing test.
    const timers: (() => void)[] = [], timeout = window.setTimeout, clear = window.clearTimeout;
    const clock = Object.getOwnPropertyDescriptor(performance, 'now');
    Object.defineProperty(performance, 'now', {configurable: true, value: () => time});
    window.setTimeout = ((callback: () => void) => { timers.push(callback); return 2_000_000_000; }) as any;
    window.clearTimeout = () => {};
    let ready: Promise<void>;
    try { ready = activateIslands(registry); }
    finally {
      window.setTimeout = timeout; window.clearTimeout = clear;
      if (clock) Object.defineProperty(performance, 'now', clock); else delete (performance as any).now;
    }
    (window as any).loadQueueControl = {
      dispose: () => deactivateIsland(kind === 'descendant' ? document.getElementById('target')! : button),
      async finish() {
        for (const callback of timers) callback();
        await ready; await Promise.resolve();
        records.push(...observer.takeRecords()); observer.disconnect();
        return {order, events, parentClicks, errors, mutations: records.length, sameButton: button === document.getElementById('action'), sameMarkup: original === document.body.innerHTML};
      },
    };
    return {order, queued: timers.length};
  }, kind);
}

for (const kind of ['root', 'descendant'] as const) for (const input of ['pointer', 'keyboard', 'click-only'] as const) {
  test(`queued ${kind} handles the first ${input} action exactly once`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    expect(await serve(page, kind)).toEqual({order: [], queued: 1});
    if (input === 'pointer') await page.locator('#action').click();
    else if (input === 'keyboard') { await page.locator('#action').focus(); await page.locator('#action').press('Enter'); }
    else await page.evaluate(() => document.getElementById('action')!.click());
    const result = await page.evaluate(() => (window as any).loadQueueControl.finish());
    expect(result).toEqual({order: ['Target', 'Slow'], events: [{trusted: input !== 'click-only', target: 'action'}], parentClicks: 0, errors: [], mutations: 0, sameButton: true, sameMarkup: true});
    expect(errors).toEqual([]);
  });
}

test('one native click promotes nested queued parent and child once without changing owned nodes', async ({page}) => {
  expect(await serve(page, 'nested')).toEqual({order: [], queued: 1});
  await page.locator('#action').click();
  expect(await page.evaluate(() => (window as any).loadQueueControl.finish())).toEqual({order: ['Parent', 'Target', 'Slow'], events: [{trusted: true, target: 'action'}], parentClicks: 1, errors: [], mutations: 0, sameButton: true, sameMarkup: true});
});

test('disposing a queued host removes first-input activation and settles readiness', async ({page}) => {
  expect(await serve(page, 'root')).toEqual({order: [], queued: 1});
  await page.evaluate(() => (window as any).loadQueueControl.dispose());
  await page.locator('#action').click();
  expect(await page.evaluate(() => (window as any).loadQueueControl.finish())).toEqual({order: ['Slow'], events: [], parentClicks: 0, errors: [], mutations: 0, sameButton: true, sameMarkup: true});
});
