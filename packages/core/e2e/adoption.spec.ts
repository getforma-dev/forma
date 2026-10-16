import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveOwnedAdoption } from './helpers/owned-adoption.js';

// Adoption in a real browser (FORMA-003; decision brief DR-5 and DR-7). The
// server HTML is served as the page, so Chromium's parser handles it (markers
// inside a textarea or title are text there, as they are for users), and the
// user's typing happens before the core module is even requested.

// Optional installed Chrome is useful on machines without Playwright's bundle.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

const STATE_HASH = '0123456789abcdef';
async function serve(page: Page, body: string, islandCount = 0): Promise<void> {
  await serveOwnedAdoption(page, '/adoption-core.mjs');
  const state = islandCount ? `<script type="application/json" data-island-state>${JSON.stringify({
    v: 1, s: [], i: Array.from({ length: islandCount }, () => ({ h: STATE_HASH, p: {} })),
  })}</script>` : '';
  await page.route('**/adoption-core.mjs', (route) => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)),
    contentType: 'text/javascript',
  }));
  await page.route('**/adoption.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><title>Adoption</title>${state}</head><body>${body}</body></html>`,
  }));
  await page.goto('/adoption.html');
}

/** What a form submitted now would send. */
const formData = (page: Page, selector = 'form') =>
  page.evaluate((sel) => [...new FormData(document.querySelector(sel) as HTMLFormElement)], selector);

test('a root Fragment from the server is interactive under caller-owned direct adoption', async ({ page }) => {
  await serve(page, '<div id="app" data-forma-ssr><span id="note"><!--f:t0-->hello<!--/f:t0--></span><button id="go">go</button></div>');
  await page.evaluate(async () => {
    const { h, Fragment, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const [note, setNote] = createSignal('hello');
    (window as any).serverSpan = document.getElementById('note');
    adoptMatching(() => h(Fragment, null,
      h('span', { id: 'note' }, () => note()),
      h('button', { id: 'go', onClick: () => setNote(note() === 'bye' ? 'hello' : 'bye') }, 'go'),
    ), '#app');
  });
  await expect(page.locator('#app')).toHaveAttribute('data-forma-ssr', '');
  await page.locator('#go').click();
  await expect(page.locator('#note')).toHaveText('bye');
  await page.locator('#go').click();
  await expect(page.locator('#note')).toHaveText('hello');
  await page.locator('#go').click();
  await expect(page.locator('#note')).toHaveText('bye');
  expect(await page.evaluate(() => document.getElementById('note') === (window as any).serverSpan)).toBe(true);
  await expect(page.locator('#app span')).toHaveCount(1);
});

test('edited public controls and mismatched legacy defaults refuse without changing what the user entered', async ({ page }) => {
  await serve(page,
    '<div id="app" data-forma-ssr><form>' +
    '<input id="text" name="text" value="Saved">' +
    '<input id="agree" name="agree" type="checkbox" checked>' +
    '<select id="cycle" name="cycle"><option value="monthly">Monthly</option><option value="yearly" selected>Yearly</option><option value="weekly">Weekly</option></select>' +
    '<textarea id="notes" name="notes">Saved notes</textarea>' +
    // An older server (before FORMA-002): marker text inside the textarea.
    '<textarea id="legacy" name="legacy"><!--f:t0-->hello<!--/f:t0--></textarea>' +
    '</form></div>');

  // The user acts before the module loads.
  await page.locator('#text').fill('Typed');
  await page.locator('#agree').uncheck();
  await page.locator('#cycle').selectOption('weekly');
  await page.locator('#notes').fill('Typed notes');
  await page.locator('#legacy').fill('Typed legacy');
  await page.locator('#text').focus();

  await page.evaluate(async () => {
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    const [state, setState] = createSignal({ text: 'Saved', agree: true, cycle: 'yearly', notes: 'Saved notes', legacy: 'hello' });
    (window as any).setState = setState;
    adoptRefused(() => h('form', null,
      h('input', { id: 'text', name: 'text', value: () => state().text }),
      h('input', { id: 'agree', name: 'agree', type: 'checkbox', checked: () => state().agree }),
      h('select', { id: 'cycle', name: 'cycle', value: () => state().cycle },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly'), h('option', { value: 'weekly' }, 'Weekly')),
      h('textarea', { id: 'notes', name: 'notes', value: () => state().notes }),
      h('textarea', { id: 'legacy', name: 'legacy' }, () => state().legacy),
    ), '#app', 'FORMA_E_HYDRATE_VALUE');
  });

  await expect(page.locator('#app')).toHaveAttribute('data-forma-ssr', '');
  await expect(page.locator('#text')).toHaveValue('Typed');
  await expect(page.locator('#text')).toBeFocused();
  await expect(page.locator('#agree')).not.toBeChecked();
  await expect(page.locator('#cycle')).toHaveValue('weekly');
  await expect(page.locator('#notes')).toHaveValue('Typed notes');
  await expect(page.locator('#legacy')).toHaveValue('Typed legacy');
  // Refusal preserves the older default byte-for-byte as well as the live edit.
  expect(await page.locator('#legacy').evaluate((el: HTMLTextAreaElement) => el.defaultValue)).toBe('<!--f:t0-->hello<!--/f:t0-->');
  expect(await formData(page)).toEqual([
    ['text', 'Typed'], ['cycle', 'weekly'], ['notes', 'Typed notes'], ['legacy', 'Typed legacy'],
  ]);

  // The refused owner has no bindings; subsequent signal changes remain inert.
  await page.evaluate(() => (window as any).setState({ text: 'Reset', agree: true, cycle: 'monthly', notes: 'Reset notes', legacy: 'reset' }));
  await expect(page.locator('#text')).toHaveValue('Typed');
  await expect(page.locator('#agree')).not.toBeChecked();
  await expect(page.locator('#cycle')).toHaveValue('weekly');
  await expect(page.locator('#notes')).toHaveValue('Typed notes');
  // The legacy textarea was not normalized or rebound.
  await expect(page.locator('#legacy')).toHaveValue('Typed legacy');
  expect(await page.locator('#legacy').evaluate((el: HTMLTextAreaElement) => el.defaultValue)).toBe('<!--f:t0-->hello<!--/f:t0-->');
});

test('matching public readonly edits refuse, while explicit literal initialization preserves edits without seeding', async ({ page }) => {
  await serve(page,
    '<div id="readonly" data-forma-ssr><input id="read" value="server"></div>' +
    '<div id="literal" data-forma-ssr><form><input id="text" name="text" value="server"><input id="check" name="check" type="checkbox" checked><textarea id="area" name="area">notes</textarea></form></div>');
  await page.locator('#read').fill('readonly edit'); await page.locator('#text').fill('literal edit');
  await page.locator('#check').uncheck(); await page.locator('#area').fill('edited notes'); await page.locator('#text').focus();
  const result = await page.evaluate(async () => {
    const input = document.getElementById('text') as HTMLInputElement;
    input.setSelectionRange(1,4,'backward');
    const { h, createSignal } = await import('/adoption-core.mjs' as string);
    const { adoptMatching, adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    const [value,setValue] = createSignal('server');
    adoptRefused(() => h('input', {id:'read',value}), '#readonly', 'FORMA_E_HYDRATE_INPUT_TARGET');
    setValue('ignored');
    const literal = document.getElementById('literal')!, before = literal.outerHTML, nodes = [...literal.querySelectorAll('*')];
    const records: MutationRecord[] = [], observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(literal,{subtree:true,childList:true,attributes:true,characterData:true});
    adoptMatching(() => h('form',null,h('input',{id:'text',name:'text',value:'server'}),h('input',{id:'check',name:'check',type:'checkbox',checked:true}),h('textarea',{id:'area',name:'area'},'notes')), literal);
    await new Promise(resolve=>setTimeout(resolve,0)); records.push(...observer.takeRecords());
    const zeroWrites = records.length === 0, identity = before === literal.outerHTML && [...literal.querySelectorAll('*')].every((node,i)=>node===nodes[i]);
    literal.setAttribute('data-observer-control','yes'); await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());observer.disconnect();
    return {zeroWrites,identity,positiveObserver:records.length>0,focus:document.activeElement===input,selection:[input.selectionStart,input.selectionEnd,input.selectionDirection]};
  });
  expect(result).toEqual({zeroWrites:true,identity:true,positiveObserver:true,focus:true,selection:[1,4,'backward']});
  await expect(page.locator('#read')).toHaveValue('readonly edit'); await expect(page.locator('#text')).toHaveValue('literal edit');
  await expect(page.locator('#check')).not.toBeChecked(); await expect(page.locator('#area')).toHaveValue('edited notes');
  expect(await formData(page,'#literal form')).toEqual([['text','literal edit'],['area','edited notes']]);
});

test('an untouched page whose server agrees with the client is adopted without one DOM write', async ({ page }) => {
  // forma-ir 0.2.1 output (FORMA-002): no markers in textarea or title, `selected` on the option.
  await serve(page,
    '<div id="app" data-forma-ssr><form>' +
    '<input id="text" name="text" value="Saved"><input id="agree" name="agree" type="checkbox" checked>' +
    '<select id="cycle" name="cycle"><option value="monthly">Monthly</option><option value="yearly" selected>Yearly</option></select>' +
    '<textarea id="notes" name="notes">hello</textarea><div><title id="tt">Page</title></div>' +
    '</form></div>');
  const before = await formData(page);

  const records = await page.evaluate(async () => {
    const seen: string[] = [];
    const observer = new MutationObserver((batch) => {
      for (const r of batch) seen.push(`${r.type}:${(r.target as Element).id || (r.target as Node).nodeName}:${r.attributeName ?? ''}`);
    });
    observer.observe(document.getElementById('app')!, { subtree: true, childList: true, attributes: true, characterData: true });
    const { h, mount } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    adoptMatching(() => h('form', null,
      h('input', { id: 'text', name: 'text', value: () => 'Saved' }),
      h('input', { id: 'agree', name: 'agree', type: 'checkbox', checked: () => true }),
      h('select', { id: 'cycle', name: 'cycle', value: () => 'yearly' },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly')),
      h('textarea', { id: 'notes', name: 'notes' }, () => 'hello'),
      h('div', null, h('title', { id: 'tt' }, () => 'Page')),
    ), '#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    seen.push(...observer.takeRecords().map((r) => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`));
    const measured = seen.slice();
    document.getElementById('app')!.setAttribute('data-observer-control', 'yes');
    await new Promise(resolve => setTimeout(resolve, 0));
    seen.push(...observer.takeRecords().map(r => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`));
    observer.disconnect();
    if (!seen.includes('attributes:app:data-observer-control')) throw new Error('Mutation observer did not observe its positive control');
    return measured;
  });

  expect(records).toEqual([]);
  expect(await formData(page)).toEqual(before);
  expect(before).toEqual([['text', 'Saved'], ['agree', 'on'], ['cycle', 'yearly'], ['notes', 'hello']]);
});

test("an older server's marker text and unselected select refuse without repair", async ({ page }) => {
  // forma-ir 0.2.0 output: markers inside RCDATA, `value=` on the select.
  await serve(page,
    '<div id="app" data-forma-ssr><form>' +
    '<textarea id="ta" name="ta"><!--f:t0-->hello<!--/f:t0--></textarea>' +
    '<select id="choice" name="choice" value="b"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>' +
    '<div><title id="tt"><!--f:t0-->hello<!--/f:t0--></title></div>' +
    '</form></div>');
  // The defects as served (verification run 2 and run 3).
  expect(await formData(page)).toEqual([['ta', '<!--f:t0-->hello<!--/f:t0-->'], ['choice', 'a']]);
  await expect(page.locator('#tt')).toHaveText('<!--f:t0-->hello<!--/f:t0-->');

  await page.evaluate(async () => {
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    const [text, setText] = createSignal('hello');
    const [choice, setChoice] = createSignal('b');
    Object.assign(window as any, { setText, setChoice });
    adoptRefused(() => h('form', null,
      h('textarea', { id: 'ta', name: 'ta' }, () => text()),
      h('select', { id: 'choice', name: 'choice', value: () => choice() },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')),
      h('div', null, h('title', { id: 'tt' }, () => text())),
    ), '#app', 'FORMA_E_HYDRATE_VALUE');
  });

  expect(await formData(page)).toEqual([['ta', '<!--f:t0-->hello<!--/f:t0-->'], ['choice', 'a']]);
  await expect(page.locator('#tt')).toHaveText('<!--f:t0-->hello<!--/f:t0-->');
  await page.evaluate(() => { (window as any).setText('updated'); (window as any).setChoice('c'); });
  expect(await formData(page)).toEqual([['ta', '<!--f:t0-->hello<!--/f:t0-->'], ['choice', 'a']]);
  await expect(page.locator('#tt')).toHaveText('<!--f:t0-->hello<!--/f:t0-->');
});

test("after the user types, a textarea's reactive text controls its live and default values, client-rendered and adopted alike", async ({ page }) => {
  await serve(page, '<div id="csr"></div><div id="ssr" data-forma-ssr><textarea id="adopted">Hello Ann</textarea></div>');
  await page.evaluate(async () => {
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const [text, setText] = createSignal('Hello Ann');
    (window as any).setText = setText;
    mount(() => h('textarea', { id: 'rendered' }, () => text()), '#csr');
    adoptMatching(() => h('textarea', { id: 'adopted' }, () => text()), '#ssr');
  });
  for (const id of ['#rendered', '#adopted']) {
    await expect(page.locator(id)).toHaveValue('Hello Ann');
    await page.locator(id).fill('Hello Ann, my long message');
  }
  await page.evaluate(() => (window as any).setText('Hello Bob'));
  for (const id of ['#rendered', '#adopted']) {
    await expect(page.locator(id)).toHaveValue('Hello Bob');
    expect(await page.locator(id).evaluate((el: HTMLTextAreaElement) => el.defaultValue)).toBe('Hello Bob');
  }
});

test('components returning real DOM nodes are refused without replacing originals or aborting the module', async ({ page }) => {
  await serve(page,
    '<div id="app" data-forma-ssr><p>static</p></div>' +
    '<div data-forma-island="0" data-forma-component="Imp" data-forma-state="0" data-forma-h="0123456789abcdef"><button id="imp">0</button></div>' +
    '<div data-forma-island="1" data-forma-component="Detached" data-forma-state="1" data-forma-h="0123456789abcdef"><span>server</span></div>', 2);
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));

  await page.evaluate(async () => {
    const { mount, activateIslands, __islandRegistration, createSignal, createEffect, template, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    adoptRefused(() => template(trustedHtml('<p>static</p>')), '#app', 'FORMA_E_HYDRATE_STRUCTURE');
    (window as any).afterDirectAdoption = true;
    const metadata = { h: '0123456789abcdef', schema: [[]], mode: 0 as const };
    const el = document.querySelector('[data-forma-component="Imp"]') as HTMLElement;
    activateIslands({
      Imp: __islandRegistration(() => {
        const [n, setN] = createSignal(0);
        const button = el.querySelector('button')!;
        button.addEventListener('click', () => setN(n() + 1));
        createEffect(() => { button.textContent = String(n()); });
        return el;
      }, metadata),
      Detached: __islandRegistration(() => document.createElement('span'), metadata),
    });
  });

  expect(await page.evaluate(() => (window as any).afterDirectAdoption)).toBe(true);
  await expect(page.locator('#app')).toHaveAttribute('data-forma-ssr', '');
  await expect(page.locator('#app')).toHaveText('static');
  await expect(page.locator('[data-forma-island="0"]')).toHaveAttribute('data-forma-status', 'error');
  await page.locator('#imp').click();
  await page.locator('#imp').click();
  await expect(page.locator('#imp')).toHaveText('0');
  await expect(page.locator('[data-forma-island="1"]')).toHaveAttribute('data-forma-status', 'error');
  await expect(page.locator('[data-forma-island="1"]')).toHaveText('server');
  expect(errors.filter((e) => e.startsWith('uncaught'))).toEqual([]);
  expect(errors.filter((e) => e.includes('FORMA_E_HYDRATE_STRUCTURE'))).toHaveLength(3);
});

test('a detached real-Node description reports STRUCTURE while a healthy sibling activates',async({page})=>{
  // The admitted native subset uses descriptions, not component-returned DOM
  // nodes. This runtime defense deliberately uses a forged source shape to
  // prove the production refusal event and independent sibling activation.
  await serve(page,'<main id="app" data-forma-ssr>'+
    '<div data-forma-island="0" data-forma-component="Detached" data-forma-state="0" data-forma-h="0123456789abcdef"><span>server</span></div>'+
    '<button id="healthy" data-forma-island="1" data-forma-component="Healthy" data-forma-state="1" data-forma-h="0123456789abcdef" data-forma-status="pending">healthy</button></main>',2);
  const consoleErrors:string[]=[],uncaught:string[]=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',error=>uncaught.push(error.message));
  const observed=await page.evaluate(async()=>{
    const {h,mount,activateIslands,__islandRegistration}=await import('/adoption-core.mjs' as string);
    const events:unknown[]=[];
    document.addEventListener('forma:error',event=>events.push((event as CustomEvent).detail));
    const original=document.querySelector('[data-forma-component="Detached"]')!,child=original.firstChild;
    let mountReturned=false;
    mount(()=>{throw new Error('the removed native page mount must not execute');},'#app');mountReturned=true;
    (window as any).__healthyCalls=0;
    const metadata={h:'0123456789abcdef',schema:[[]],mode:0 as const};
    activateIslands({
      Detached:__islandRegistration(()=>document.createElement('span'),metadata),
      Healthy:__islandRegistration(()=>h('button',{id:'healthy',onClick:()=>{(window as any).__healthyCalls++;}},'healthy'),metadata),
    });
    return {mountReturned,events,sameOriginal:document.querySelector('[data-forma-component="Detached"]')===original&&original.firstChild===child};
  });
  expect(observed.mountReturned).toBe(true);expect(observed.sameOriginal).toBe(true);
  expect(observed.events).toHaveLength(1);
  expect(observed.events[0]).toMatchObject({island:'Detached',occurrence:0,code:'FORMA_E_HYDRATE_STRUCTURE'});
  await expect(page.locator('[data-forma-component="Detached"]')).toHaveAttribute('data-forma-status','error');
  await expect(page.locator('[data-forma-component="Detached"]')).toHaveText('server');
  await expect(page.locator('#healthy')).toHaveAttribute('data-forma-status','pending');
  await page.locator('#healthy').click();
  expect(await page.evaluate(()=>(window as any).__healthyCalls)).toBe(1);
  expect(consoleErrors).toHaveLength(1);expect(consoleErrors[0]).toContain('FORMA_E_HYDRATE_STRUCTURE');
  expect(uncaught).toEqual([]);
});

test('an option bound to undefined submits its text, client-rendered and adopted', async ({ page }) => {
  await serve(page,
    '<form id="csr"></form>' +
    '<div id="ssr" data-forma-ssr><form id="adopted"><select name="s"><option>Alpha</option><option>Beta</option></select></form></div>');
  await page.evaluate(async () => {
    const { h, mount } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    mount(() => h('select', { name: 'c' }, h('option', { value: undefined }, 'Alpha'), h('option', { value: null }, 'Beta')), '#csr');
    adoptMatching(() => h('form', { id: 'adopted' },
      h('select', { name: 's' }, h('option', { value: () => undefined }, 'Alpha'), h('option', { value: () => null }, 'Beta'))), '#ssr');
  });
  expect(await formData(page, '#csr')).toEqual([['c', 'Alpha']]);
  expect(await formData(page, '#adopted')).toEqual([['s', 'Alpha']]);
  await page.locator('#csr select').selectOption({ index: 1 });
  expect(await formData(page, '#csr')).toEqual([['c', 'Beta']]);
});

// FORMA-020: inline SVG and MathML (decision brief DR-5, DR-9, R7). Chromium's
// parser puts them in their own namespaces, where `tagName` is not upper-cased.
const NS = { html: 'http://www.w3.org/1999/xhtml', svg: 'http://www.w3.org/2000/svg', mathml: 'http://www.w3.org/1998/Math/MathML' };

test('an inline SVG icon is adopted without one DOM write; its title stays SVG and a bound path updates in place', async ({ page }) => {
  await serve(page, '<div id="app" data-forma-ssr><button id="close"><svg viewBox="0 0 10 10"><title>Close</title><path d="M0 0L10 10"/></svg></button></div>');
  await expect(page.locator('#close')).toHaveAccessibleName('Close');

  const adopted = await page.evaluate(async () => {
    const app = document.getElementById('app')!;
    const server = Array.from(app.querySelectorAll('*'));
    const seen: string[] = [];
    const observer = new MutationObserver((batch) => {
      for (const r of batch) seen.push(`${r.type}:${(r.target as Element).id || (r.target as Node).nodeName}:${r.attributeName ?? ''}`);
    });
    observer.observe(app, { subtree: true, childList: true, attributes: true, characterData: true });
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const [d, setD] = createSignal('M0 0L10 10');
    (window as any).setD = setD;
    adoptMatching(() => h('button', { id: 'close' },
      h('svg', { viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('path', { d: () => d() }))), '#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    seen.push(...observer.takeRecords().map((r) => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`));
    observer.disconnect();
    const now = Array.from(app.querySelectorAll('*'));
    return {
      seen,
      sameNodes: now.length === server.length && now.every((el, i) => el === server[i]),
      namespaces: now.map((el) => `${el.localName}:${el.namespaceURI}`),
    };
  });

  expect(adopted.seen).toEqual([]);
  expect(adopted.sameNodes).toBe(true);
  expect(adopted.namespaces).toEqual([`button:${NS.html}`, `svg:${NS.svg}`, `title:${NS.svg}`, `path:${NS.svg}`]);
  await expect(page.locator('#close')).toHaveAccessibleName('Close');

  for (const next of ['M10 0L0 10', 'M0 5L10 5', 'M0 0L10 10']) {
    const updated = await page.evaluate(async (d) => {
      const path = document.querySelector('#app path')!;
      const seen: string[] = [];
      const record = (batch: MutationRecord[]) => seen.push(...batch.map(r => `${r.type}:${(r.target as Element).localName}:${r.attributeName ?? ''}`));
      const observer = new MutationObserver(record);
      observer.observe(document.getElementById('app')!, { subtree: true, childList: true, attributes: true, characterData: true });
      (window as any).setD(d);
      await new Promise(resolve => setTimeout(resolve, 0));
      record(observer.takeRecords());
      observer.disconnect();
      return { seen, same: document.querySelector('#app path') === path, d: path.getAttribute('d') };
    }, next);
    expect(updated).toEqual({ seen: ['attributes:path:d'], same: true, d: next });
  }
});

test('SVG and MathML refuse missing or differing originals, then matching native trees update in place', async ({ page }) => {
  await serve(page,
    '<div id="app" data-forma-ssr><div><p id="formula"><math><mi>x</mi></math></p>' +
    '<svg id="icon" viewBox="0 0 10 10"><circle r="1"/></svg></div></div>' +
    '<div id="matching" data-forma-ssr><div><p id="formula2"><math><mi><!--f:t0-->x<!--/f:t0--></mi><mo>+</mo><mn>1</mn></math></p>' +
    '<svg id="icon2" viewBox="0 0 10 10"><title>Close</title><a href="#close"><path d="M0 0L10 10"/></a></svg></div></div>');
  const result = await page.evaluate(async () => {
    const { h, createSignal } = await import('/adoption-core.mjs' as string);
    const { adoptMatching, adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    const bad = document.getElementById('app')!, before = bad.outerHTML;
    const math = bad.querySelector('math'), mi = bad.querySelector('mi'), icon = bad.querySelector('svg');
    const [x, setX] = createSignal('x');
    adoptRefused(() => h('div', null,
      h('p', { id: 'formula' }, h('math', null, h('mi', null, x), h('mo', null, '+'), h('mn', null, '1'))),
      h('svg', { id: 'icon', viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('a', { href: '#close' }, h('path', { d: 'M0 0L10 10' }))),
    ), bad, 'FORMA_E_HYDRATE_MARKER');
    setX('ignored');
    const valid = document.getElementById('matching')!, nodes = [...valid.querySelectorAll('*')];
    const [value, setValue] = createSignal('x'); (window as any).setX = setValue;
    adoptMatching(() => h('div', null,
      h('p', { id: 'formula2' }, h('math', null, h('mi', null, value), h('mo', null, '+'), h('mn', null, '1'))),
      h('svg', { id: 'icon2', viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('a', { href: '#close' }, h('path', { d: 'M0 0L10 10' }))),
    ), valid);
    const ns = (selector: string) => [...document.querySelectorAll(selector)].map(el => el.localName + ':' + el.namespaceURI);
    return {
      refusedUnchanged: bad.outerHTML === before && bad.querySelector('math') === math && bad.querySelector('mi') === mi && bad.querySelector('svg') === icon,
      matchedIdentity: [...valid.querySelectorAll('*')].every((node,i) => node === nodes[i]),
      math: ns('#formula2 *'), svg: ns('#icon2 *'),
    };
  });
  expect(result.refusedUnchanged).toBe(true); expect(result.matchedIdentity).toBe(true);
  expect(result.math).toEqual([`math:${NS.mathml}`, `mi:${NS.mathml}`, `mo:${NS.mathml}`, `mn:${NS.mathml}`]);
  expect(result.svg).toEqual([`title:${NS.svg}`, `a:${NS.svg}`, `path:${NS.svg}`]);
  await expect(page.locator('#formula2')).toHaveText('x+1');
  await page.evaluate(() => (window as any).setX('y'));
  await expect(page.locator('#formula2')).toHaveText('y+1');
});

test("a bound iframe src the server already rendered is not set again, so the frame is not reloaded", async ({ page }) => {
  await page.route(/\/frame\.html/, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><p>frame ${new URL(route.request().url()).search}</p>`,
  }));
  await serve(page, '<div id="app" data-forma-ssr><iframe id="frame" src="/frame.html" title="frame"></iframe></div>');
  await page.waitForFunction(() => (document.getElementById('frame') as HTMLIFrameElement).contentDocument?.readyState === 'complete');

  const result = await page.evaluate(async () => {
    const frame = document.getElementById('frame') as HTMLIFrameElement;
    let loads = 0;
    frame.addEventListener('load', () => loads++);
    (frame.contentWindow as any).state = 'kept';
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const [src, setSrc] = createSignal('/frame.html');
    (window as any).setSrc = setSrc;
    adoptMatching(() => h('iframe', { id: 'frame', src: () => src(), title: 'frame' }), '#app');
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { loads, state: (frame.contentWindow as any).state ?? null };
  });
  expect(result).toEqual({ loads: 0, state: 'kept' });

  // A real change still navigates the frame.
  await page.evaluate(() => (window as any).setSrc('/frame.html?next'));
  await expect(page.frameLocator('#frame').locator('p')).toHaveText('frame ?next');
});

// FORMA-123 (decision brief DR-8): rows without data-forma-key are matched by
// index, so a client array whose length differs from the server's rows fails
// the island instead of removing or adding rows.
test('a list whose client array differs in count from the server rows leaves the island error with its code and removes no node', async ({ page }) => {
  const rows = (n: number) => `<ul><!--f:l0-->${Array.from({ length: n }, (_, i) => `<li>row ${i}</li>`).join('')}<!--/f:l0--></ul>`;
  await serve(page,
    `<div data-forma-island="0" data-forma-component="Fewer" data-forma-state="0" data-forma-h="0123456789abcdef"><button id="fewer">go</button>${rows(3)}</div>` +
    `<div data-forma-island="1" data-forma-component="More" data-forma-state="1" data-forma-h="0123456789abcdef"><button id="more">go</button>${rows(3)}</div>` +
    `<div data-forma-island="2" data-forma-component="Equal" data-forma-state="2" data-forma-h="0123456789abcdef"><button id="equal">go</button>${rows(3)}</div>`, 3);
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
  const served = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-forma-island="${i}"]`)!.innerHTML));

  const result = await page.evaluate(async () => {
    const records: string[] = [];
    const observer = new MutationObserver((batch) => {
      for (const r of batch) {
        const island = (r.target as Element).closest?.('[data-forma-island]') ?? (r.target.parentElement?.closest('[data-forma-island]'));
        const id = island?.getAttribute('data-forma-island');
        records.push(`${r.type}:${id}:${r.attributeName ?? ''}:${r.removedNodes.length}:${r.addedNodes.length}`);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const { h, activateIslands, __islandRegistration, createList, createSignal, onError } = await import('/adoption-core.mjs' as string);

    const codes: string[] = [];
    onError((err: { code?: string }, info?: { source?: string }) => codes.push(`${err.code}:${info?.source}`));
    const clicks: string[] = [];
    const [fewer, setFewer] = createSignal(['row 0', 'row 1']);
    const [more, setMore] = createSignal(['row 0', 'row 1', 'row 2', 'row 3']);
    const [equal, setEqual] = createSignal(['row 0', 'row 1', 'row 2']);
    Object.assign(window as any, { setFewer, setMore, setEqual, clicks });
    const island = (name: string, items: () => string[]) => () => h('div', null,
      h('button', { id: name, onClick: () => clicks.push(name) }, 'go'),
      h('ul', null, createList(items, (x: string) => x, (x: string) => h('li', null, x))));
    const metadata = { h: '0123456789abcdef', schema: [[]], mode: 0 as const };
    activateIslands({ Fewer: __islandRegistration(island('fewer', fewer), metadata),
      More: __islandRegistration(island('more', more), metadata),
      Equal: __islandRegistration(island('equal', equal), metadata) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    records.push(...observer.takeRecords().map((r) => `${r.type}:late`));
    observer.disconnect();
    return { records, codes };
  });

  expect(result.codes).toEqual(['FORMA_E_HYDRATE_LIST_COUNT:hydration', 'FORMA_E_HYDRATE_LIST_COUNT:hydration']);
  // Status changes only: no node removed, added or rewritten in either failed island.
  expect(result.records).toEqual([
    'attributes:0:data-forma-status:0:0', 'attributes:1:data-forma-status:0:0',
  ]);
  await expect(page.locator('[data-forma-island="0"]')).toHaveAttribute('data-forma-status', 'error');
  await expect(page.locator('[data-forma-island="1"]')).toHaveAttribute('data-forma-status', 'error');
  await expect(page.locator('[data-forma-island="2"]')).not.toHaveAttribute('data-forma-status');
  expect(await page.locator('[data-forma-island="2"]').evaluate(el => typeof (el as any).__formaDispose)).toBe('function');
  expect(errors.filter((e) => e.startsWith('uncaught'))).toEqual([]);
  const coded = errors.filter((e) => e.includes('FORMA_E_HYDRATE_LIST_COUNT'));
  expect(coded).toHaveLength(2);
  // Fragment/empty rows cannot be inferred from element counts; report exact DOM extent.
  expect(coded[0]).toContain('1 unconsumed top-level DOM node');
  expect(coded[0]).toContain('2 items');
  expect(coded[1]).toContain('4 items');

  // The failed islands are inert; the equal-count island is live.
  await page.locator('#fewer').click();
  await page.locator('#more').click();
  await page.locator('#equal').click();
  expect(await page.evaluate(() => (window as any).clicks)).toEqual(['equal']);
  await page.evaluate(() => {
    (window as any).setFewer(['a']);
    (window as any).setMore(['a', 'b', 'c', 'd', 'e']);
    (window as any).setEqual(['row 2', 'row 1', 'row 0', 'row 3']);
  });
  expect(await page.evaluate(() => [0, 1].map((i) => document.querySelector(`[data-forma-island="${i}"]`)!.innerHTML))).toEqual(served.slice(0, 2));
  await expect(page.locator('[data-forma-island="2"] li')).toHaveText(['row 2', 'row 1', 'row 0', 'row 3']);
});

// FORMA-026 (decision brief DR-9): the shared namespace vectors through each
// engine's parser. src/__tests__/renderer-contract.test.ts runs the same file
// through h() and renderToString; here the browser parses the server markup,
// h() builds the tree, and adoption binds the parsed markup.
type NsTree = [string, Record<string, unknown> | null, ...unknown[]];
const NS_VECTORS = (JSON.parse(readFileSync(new URL('../../../crates/forma-ir/tests/fixtures/parity/namespaces.json', import.meta.url), 'utf8')) as {
  vectors: Array<{ name: string; server: string; tree: NsTree; namespaces: string[] }>;
}).vectors;

test('the namespace vectors: the parser, h() and adoption agree on every element and on the markup', async ({ page }) => {
  await serve(page, NS_VECTORS.map((v, i) => `<div class="ssr" id="ssr${i}" data-forma-ssr>${v.server}</div><div id="csr${i}"></div>`).join(''));
  const results = await page.evaluate(async (vectors) => {
    const { h, mount } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const short: Record<string, string> = {
      'http://www.w3.org/1999/xhtml': 'html', 'http://www.w3.org/2000/svg': 'svg', 'http://www.w3.org/1998/Math/MathML': 'mathml',
    };
    // The server's markup is adopted from the eager tree (adoption builds
    // nothing); the client renders each child once its parent exists, as a
    // reactive child is built, so h() takes the parser's namespace from it.
    const build = ([tag, props, ...children]: NsTree): unknown =>
      h(tag, props, ...children.map((c) => (typeof c === 'string' ? c : build(c as NsTree))));
    const builtWithParent = ([tag, props, ...children]: NsTree): unknown =>
      h(tag, props, ...children.map((c) => (typeof c === 'string' ? c : () => builtWithParent(c as NsTree))));
    const namespaces = (root: Element) =>
      [root, ...Array.from(root.querySelectorAll('*'))].map((el) => `${el.localName}:${short[el.namespaceURI ?? ''] ?? el.namespaceURI}`);
    return await Promise.all(vectors.map(async (v, i) => {
      const ssr = document.getElementById(`ssr${i}`)!;
      const parsedRoot = ssr.firstElementChild!;
      const parsed = namespaces(parsedRoot);
      const parsedHtml = parsedRoot.outerHTML;
      const hasScript = ([tag, , ...children]: NsTree): boolean =>
        tag.toLowerCase() === 'script' || children.some(c => Array.isArray(c) && hasScript(c as NsTree));
      if (hasScript(v.tree)) {
        const refused: string[] = [];
        for (const render of [() => builtWithParent(v.tree), () => build(v.tree)]) {
          try { render(); } catch (error) { refused.push(String(error)); }
        }
        return { name: v.name, parsed, refused };
      }
      mount(() => builtWithParent(v.tree), `#csr${i}`);
      const built = document.getElementById(`csr${i}`)!.firstElementChild!;
      const writes: string[] = [];
      const record = (batch: MutationRecord[]) => writes.push(...batch.map(r => `${r.type}:${(r.target as Element).id || (r.target as Element).localName}:${r.attributeName ?? ''}`));
      const observer = new MutationObserver(record);
      observer.observe(ssr, { subtree: true, childList: true, attributes: true, characterData: true });
      adoptMatching(() => build(v.tree), `#ssr${i}`);
      await new Promise(resolve => setTimeout(resolve, 0));
      record(observer.takeRecords());
      const measured = writes.slice();
      ssr.setAttribute('data-observer-control', 'yes');
      await new Promise(resolve => setTimeout(resolve, 0));
      record(observer.takeRecords());
      observer.disconnect();
      if (!writes.includes(`attributes:ssr${i}:data-observer-control`)) throw new Error('Mutation observer did not observe its positive control');
      return {
        name: v.name, parsed, built: namespaces(built), adopted: namespaces(ssr.firstElementChild!),
        sameNode: ssr.firstElementChild === parsedRoot, parsedHtml, builtHtml: built.outerHTML, writes: measured,
      };
    }));
  }, NS_VECTORS);

  for (const [i, r] of results.entries()) {
    const v = NS_VECTORS[i]!;
    expect({ name: r.name, parsed: r.parsed }).toEqual({ name: v.name, parsed: v.namespaces });
    if ('refused' in r) {
      expect(r.refused).toHaveLength(2);
      for (const error of r.refused!) expect(error).toContain('FORMA_E_SCRIPT_ELEMENT');
      continue;
    }
    expect({ name: r.name, built: r.built }).toEqual({ name: v.name, built: v.namespaces });
    expect({ name: r.name, html: r.builtHtml }).toEqual({ name: v.name, html: r.parsedHtml });
    expect({ name: r.name, html: r.builtHtml }).toEqual({ name: v.name, html: v.server });
    expect({ name: r.name, adopted: r.adopted, sameNode: r.sameNode, writes: r.writes }).toEqual({
      name: v.name, adopted: v.namespaces, sameNode: true, writes: [],
    });
  }
});

test('content built inside an svg is SVG and rendered once: a createShow branch, list rows, switch cases, a portal; a foreignObject holds HTML', async ({ page }) => {
  await serve(page, '<div id="app"></div><svg id="target"></svg>' +
    '<div id="adopt" data-forma-ssr><svg viewBox="0 0 10 10"><g id="show"><!--f:s0--><title>On</title><!--/f:s0--></g>' +
    '<g id="rows"><!--f:l0--><a data-forma-key="a" href="#a"><title>a</title></a><a data-forma-key="b" href="#b"><title>b</title></a><!--/f:l0--></g></svg></div>');
  const steps = await page.evaluate(async () => {
    const { h, svg, mount, createSignal, createShow, createList, createSwitch, createPortal } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const renders = { show: 0, rows: 0, cases: 0 };
    const SVG = 'http://www.w3.org/2000/svg';
    const nonSvg = (root: Element) =>
      Array.from(root.querySelectorAll('*')).filter((el) => el.namespaceURI !== SVG && !el.closest('foreignObject')).map((el) => el.localName);
    const [on, setOn] = createSignal(true);
    const [keys, setKeys] = createSignal(['a', 'b']);
    const [tab, setTab] = createSignal('a');
    // The documented way for a hand-written tree: build it inside svg(), and
    // build the foreignObject's content outside it.
    const foreign = h('div', null, h('a', { href: '#html' }, 'html'));
    mount(() => svg(() => h('svg', { id: 'built', viewBox: '0 0 10 10' },
      h('g', { id: 'g-show' }, createShow(on, () => { renders.show++; return h('title', null, 'On'); }, () => { renders.show++; return h('a', { href: '#off' }, h('circle', { r: '1' })); })),
      h('g', { id: 'g-rows' }, createList(keys, (k: string) => k, (k: string) => { renders.rows++; return h('a', { href: `#${k}` }, h('title', null, k)); })),
      h('g', { id: 'g-switch' }, createSwitch(tab, [
        { match: 'a', render: () => { renders.cases++; return h('a', { href: '#a' }, 'A'); } },
        { match: 't', render: () => { renders.cases++; return h('title', null, 'T'); } },
      ], () => { renders.cases++; return h('style', null, 'circle{}'); })),
      h('foreignObject', { width: '10', height: '10' }, foreign),
    )), '#app');
    createPortal(() => h('title', null, 'Portaled'), document.getElementById('target')!);
    const warn = console.warn;
    console.warn = () => {};
    const [aOn, setAOn] = createSignal(true);
    const [aKeys, setAKeys] = createSignal(['a', 'b']);
    adoptMatching(() => h('svg', { viewBox: '0 0 10 10' },
      h('g', { id: 'show' }, createShow(aOn, () => h('title', null, 'On'), () => h('a', { href: '#off' }, 'Off'))),
      h('g', { id: 'rows' }, createList(aKeys, (k: string) => k, (k: string) => h('a', { 'data-forma-key': k, href: `#${k}` }, h('title', null, k)))),
    ), '#adopt');
    console.warn = warn;

    const built = document.getElementById('built')!;
    const snapshot = (label: string) => ({
      label,
      nonSvg: [...nonSvg(built), ...nonSvg(document.getElementById('target')!), ...nonSvg(document.querySelector('#adopt svg')!)],
      htmlInForeignObject: Array.from(built.querySelectorAll('foreignObject *'), (el) => `${el.localName}:${el.namespaceURI === SVG ? 'svg' : 'html'}`),
      shown: [built.querySelector('#g-show')!.firstElementChild?.localName, document.querySelector('#adopt #show')!.firstElementChild?.localName],
      renders: { ...renders },
    });
    const out = [snapshot('first render')];
    setOn(false); setKeys(['c', 'a', 'b']); setTab('t'); setAOn(false); setAKeys(['c', 'a', 'b']);
    out.push(snapshot('after one update'));
    setOn(true); setKeys(['b']); setTab('other'); setAOn(true); setAKeys(['b', 'd']);
    out.push(snapshot('after two'));
    setOn(false); setTab('a'); setAOn(false);
    out.push(snapshot('after three'));
    return out;
  });
  expect(steps.map((s) => s.label)).toEqual(['first render', 'after one update', 'after two', 'after three']);
  for (const s of steps) {
    expect({ label: s.label, nonSvg: s.nonSvg, foreign: s.htmlInForeignObject }).toEqual({
      label: s.label, nonSvg: [], foreign: ['div:html', 'a:html'],
    });
  }
  expect(steps.map((s) => s.shown)).toEqual([['title', 'title'], ['a', 'a'], ['title', 'title'], ['a', 'a']]);
  // Each branch, row and case rendered once when it appeared (cases are cached).
  expect(steps.map((s) => s.renders)).toEqual([
    { show: 1, rows: 2, cases: 1 }, { show: 2, rows: 3, cases: 2 }, { show: 3, rows: 3, cases: 3 }, { show: 4, rows: 3, cases: 3 },
  ]);
});

test('a reactive dangerouslySetInnerHTML is adopted as content, follows its signal through null and back, and matches client rendering', async ({ page }) => {
  // FORMA-176: adoption used to write the prop as an attribute
  // ("[object Object]") and never the content. The walker ships the element
  // empty in the historical case; strict preparation refuses that mismatch.
  // The matching positive still follows the client-rendered twin.
  await serve(page, '<div id="empty" data-forma-ssr><article></article></div><div id="app" data-forma-ssr><article id="doc"><b>A</b></article></div><div id="client"></div>');
  const steps = await page.evaluate(async () => {
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptMatching, adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    const [inner, setInner] = createSignal({ __html: trustedHtml('<b>A</b>') });
    adoptRefused(() => h('article', { dangerouslySetInnerHTML: () => inner() }), '#empty', 'FORMA_E_HYDRATE_VALUE');
    adoptMatching(() => h('article', { id: 'doc', dangerouslySetInnerHTML: () => inner() }), '#app');
    mount(() => h('article', { id: 'twin', dangerouslySetInnerHTML: () => inner() }), '#client');
    const doc = document.getElementById('doc')!;
    const twin = document.getElementById('twin')!;
    const seen: unknown[] = [];
    const record = () => seen.push([doc.innerHTML, twin.innerHTML, doc.getAttribute('dangerouslysetinnerhtml')]);
    record();
    for (const next of [{ __html: trustedHtml('<i>B</i>') }, null, { __html: trustedHtml('<b>A</b>') }, { __html: trustedHtml('<u>C</u>') }]) {
      setInner(next);
      record();
      if (document.querySelector('#empty article')!.innerHTML !== '') throw Error('refused raw owner revived');
    }
    return seen;
  });
  expect(steps).toEqual([
    ['<b>A</b>', '<b>A</b>', null],
    ['<i>B</i>', '<i>B</i>', null],
    ['', '', null],
    ['<b>A</b>', '<b>A</b>', null],
    ['<u>C</u>', '<u>C</u>', null],
  ]);
});

test('a falsy static dangerouslySetInnerHTML is no prop: the server\'s children are adopted and their handlers work', async ({ page }) => {
  // formajs#32's review (B1): undefined, null and false (`cond && { __html }`)
  // are no prop to h() and ./ssr, which renders the children; adoption threw
  // on false and wiped the children for the others.
  await serve(page, [0, 1, 2].map((i) => `<div id="app${i}" data-forma-ssr><article><button id="b${i}">go</button></article></div>`).join(''));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.evaluate(async () => {
    const { h, mount } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const clicks = [0, 0, 0];
    (window as any).clicks = clicks;
    [undefined, null, false].forEach((value, i) => {
      adoptMatching(() => h('article', { dangerouslySetInnerHTML: value }, h('button', { id: `b${i}`, onClick: () => { clicks[i]++; } }, 'go')), `#app${i}`);
    });
  });
  for (const i of [0, 1, 2]) await page.locator(`#b${i}`).click();
  expect(await page.evaluate(() => (window as any).clicks)).toEqual([1, 1, 1]);
  await expect(page.locator('article button')).toHaveCount(3);
  await expect(page.locator('[dangerouslysetinnerhtml]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('markup the server wrote in a form the browser serialises differently is adopted without one DOM write, and typed text survives', async ({ page }) => {
  // formajs#32's review (S1): the reviewer's non-canonical markups, as ./ssr
  // writes them. Compared in the same inert element context, each is the content the
  // client would write, so adoption writes nothing (DR-5).
  const markups = [
    '<br/>', '<br />', '<img src="x.png" alt="a" />', '<a href=x>link</a>', "<a href='x'>link</a>", '<p class="a"  id="b">x</p>',
    '<input disabled>', 'It&#39;s', '&quot;q&quot;', 'a & b', '&copy; 2026', '<B>upper</B>', '<p>one<p>two',
    '<table><tr><td>x</td></tr></table>', '<svg><path d="M0 0"/></svg>', '<div title="a<b">x</div>', '<div title="a>b">x</div>',
    '<pre>\n\nx</pre>', '<textarea>\nx</textarea>',
    '<p>It&#39;s a &quot;test&quot;</p>\n<pre><code class="language-js">const a = &quot;b&quot;;\n</code></pre>\n',
    "<label>Name <input id=typed value=''></label>",
  ];
  await serve(page, markups.map((m, i) => `<div id="m${i}" data-forma-ssr><article>${m}</article></div>`).join(''));
  await page.locator('#typed').fill('typed before activation');
  const writes = await page.evaluate(async (list) => {
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const firsts = list.map((_, i) => document.querySelector(`#m${i} article`)!.firstChild);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    for (let i = 0; i < list.length; i++) {
      observer.observe(document.querySelector(`#m${i} article`)!, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    list.forEach((markup, i) => {
      const [inner] = createSignal({ __html: trustedHtml(markup) });
      adoptMatching(() => h('article', { dangerouslySetInnerHTML: () => inner() }), `#m${i}`);
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    const count = records.length;
    document.querySelector('#m0 article')!.setAttribute('data-observer-control', 'yes');
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    observer.disconnect();
    if (!records.some(r => r.attributeName === 'data-observer-control')) throw new Error('Mutation observer did not observe its positive control');
    return {
      records: count,
      kept: list.map((_, i) => document.querySelector(`#m${i} article`)!.firstChild === firsts[i]),
    };
  }, markups);
  expect(writes.records).toBe(0);
  expect(writes.kept).toEqual(markups.map(() => true));
  await expect(page.locator('#typed')).toHaveValue('typed before activation');
});

test('a reactive dangerouslySetInnerHTML whose first value is null keeps the server\'s fallback child, bound, until markup arrives', async ({ page }) => {
  // formajs#32's review (S2): adoption emptied the element at activation.
  await serve(page, '<div id="app" data-forma-ssr><article id="doc"><button id="fb">fallback</button></article></div>');
  await page.evaluate(async () => {
    const { h, mount, createSignal, trustedHtml } = await import('/adoption-core.mjs' as string);
    const { adoptMatching } = await import('/test-owned-adoption.mjs' as string);
    const [inner, setInner] = createSignal(null);
    (window as any).clicks = 0;
    (window as any).showMarkup = () => setInner({ __html: trustedHtml('<b id="m">markup</b>') });
    adoptMatching(() => h('article', { id: 'doc', dangerouslySetInnerHTML: () => inner() },
      h('button', { id: 'fb', onClick: () => { (window as any).clicks++; } }, 'fallback')), '#app');
  });
  await page.locator('#fb').click();
  expect(await page.evaluate(() => (window as any).clicks)).toBe(1);
  await page.evaluate(() => (window as any).showMarkup());
  await expect(page.locator('#m')).toHaveText('markup');
  await expect(page.locator('#fb')).toHaveCount(0);
});
