import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

for (const attribute of ['café', 'xlink:', 'xlink:foo:bar', 'xlink:2name']) test(`a served rejected ${attribute} attribute fails one island with its code and preserves its neighbor`, async ({ page }) => {
  const hash = '0123456789abcdef';
  await page.route('**/inv1-core.mjs', route => route.fulfill({ path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript' }));
  await page.route('**/inv1.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><title>INV1</title><script type="application/json" data-island-state>${JSON.stringify({ v: 1, s: [], i: [{ h: hash, p: {} }, { h: hash, p: {} }] })}</script></head><body><div data-forma-island="0" data-forma-component="Bad" data-forma-state="0" data-forma-h="${hash}" ${attribute}="server"><span>kept</span></div><div data-forma-island="1" data-forma-component="Good" data-forma-state="1" data-forma-h="${hash}"><button title="ready">go</button></div></body></html>` }));
  await page.goto('/inv1.html');
  const initial = await page.evaluate(async attribute => {
    const { h, activateIslands, __islandRegistration, createSignal } = await import('/inv1-core.mjs' as string);
    const bad = document.querySelector('[data-forma-component="Bad"]')!, good = document.querySelector('[data-forma-component="Good"]')!;
    const kept = bad.firstChild, button = good.firstChild;
    const records: MutationRecord[] = [], errors: any[] = [];
    document.addEventListener('forma:error', event => errors.push((event as CustomEvent).detail));
    const observer = new MutationObserver(batch => records.push(...batch));
    for (const host of [bad, good]) observer.observe(host, { attributes: true, childList: true, characterData: true, subtree: true });
    const metadata = { h: '0123456789abcdef', schema: [[]], mode: 0 as const };
    await activateIslands({
      Bad: __islandRegistration(() => h('div', { [attribute]: () => 'server' }, h('span', null, 'kept')), metadata),
      Good: __islandRegistration(() => { const [value, set] = createSignal('ready'); return h('div', null, h('button', { title: value, onClick: () => set('changed') }, 'go')); }, metadata),
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    const initialWrites = records.filter(record => !(record.target === bad || record.target === good) || record.type !== 'attributes' || record.attributeName !== 'data-forma-status').map(record => record.attributeName ?? record.type);
    records.length = 0;
    (button as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    observer.disconnect();
    return { badStatus: bad.getAttribute('data-forma-status'), goodStatus: good.getAttribute('data-forma-status'), codes: errors.map(error => error.code), initialWrites, retained: kept === bad.firstChild && button === good.firstChild, badName: bad.getAttribute(attribute), title: (button as Element).getAttribute('title'), positiveWrites: records.map(record => record.attributeName ?? record.type) };
  }, attribute);
  expect(initial).toEqual({ badStatus: 'error', goodStatus: null, codes: ['FORMA_E_HYDRATE_VALUE'], initialWrites: [], retained: true, badName: 'server', title: 'changed', positiveWrites: ['title'] });
});


test('every shared INV1 name and URL vector holds on fresh and reactive browser writers', async ({ page }) => {
  const vectors = JSON.parse(readFileSync(new URL('../../../crates/forma-ir/tests/fixtures/parity/inv1.json', import.meta.url), 'utf8'));
  const cases = [...vectors.names.map((item: any) => ({ ...item, tag: 'div', value: 'value' })), ...vectors.urls];
  await page.route('**/inv1-core.mjs', route => route.fulfill({ path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript' }));
  await page.goto('/');
  const failures = await page.evaluate(async cases => {
    const { h, createRoot, createSignal } = await import('/inv1-core.mjs' as string);
    const failures: string[] = [];
    for (const item of cases) {
      const expected = item.written ? item.value.replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd') : null;
      const read = (el: Element) => item.name.startsWith('xlink:') ? el.getAttributeNS('http://www.w3.org/1999/xlink', item.name.slice(6)) : el.getAttribute(item.name);
      const staticEl = h(item.tag, { [item.name]: item.value });
      if (read(staticEl) !== expected) failures.push(item.id + ':static');
      createRoot(() => {
        const [value, set] = createSignal('safe');
        const el = h(item.tag, { [item.name]: value });
        set(item.value);
        if (read(el) !== expected) failures.push(item.id + ':reactive');
      });
    }
    return failures;
  }, cases);
  expect(failures).toEqual([]);
});
