import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Rebundle the actual published browser artifact as an application build does.
const bundled = transformSync(readFileSync(new URL('../dist/forma.esm.js', import.meta.url), 'utf8'), {
  define: { __FORMA_BUILD__: '"bundle-build"' }, minifySyntax: true,
}).code;

for (const mode of ['mismatch', 'cancel', 'storage-access', 'storage-read', 'storage-write', 'equal']) {
  test(`deployment guard in a real browser: ${mode}`, async ({ page }) => {
    let documents = 0;
    await page.route('**/skew-core.mjs', route => route.fulfill({ body: bundled, contentType: 'text/javascript' }));
    await page.route('**/skew.html', route => {
      documents++;
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><title>Skew guard</title>
        <script type="application/json" data-island-state>{"v":1,"s":[],"i":[{"h":"0123456789abcdef","p":{}}]}</script>
        </head><body><div data-forma-build="bundle-build">decoy</div>
        <div id="app" data-forma-build="${mode === 'equal' ? 'bundle-build' : 'page-build'}" data-forma-ssr>
          <div id="island" data-forma-island="0" data-forma-component="Counter" data-forma-state="0" data-forma-h="0123456789abcdef"><button title="ready">go</button></div>
          <aside id="mount">preserved</aside><span data-forma-build="bundle-build">nested decoy</span>
        </div>
        <script type="module">
          import { h, activateIslands, mount, __islandRegistration, createSignal } from '/skew-core.mjs';
          const mode = ${JSON.stringify(mode)};
          const original = document.querySelector('#island button');
          window.guard = { components: 0, mounts: 0, events: [], initialWrites: [], retained: false, ready: false };
          if (mode === 'storage-access') Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } });
          if (mode === 'storage-read') Storage.prototype.getItem = () => { throw new Error('blocked'); };
          if (mode === 'storage-write') Storage.prototype.setItem = () => { throw new Error('blocked'); };
          document.addEventListener('forma:skew', event => {
            window.guard.events.push({ ...event.detail, cancelable: event.cancelable, documentTarget: event.target === document });
            if (mode === 'cancel') event.preventDefault();
          });
          const initialRecords = [];
          const observer = new MutationObserver(batch => initialRecords.push(...batch));
          observer.observe(document.querySelector('#island'), { subtree: true, childList: true, characterData: true, attributes: true });
          await activateIslands({ Counter: __islandRegistration(() => {
            window.guard.components++;
            const [value, set] = createSignal('ready');
            return h('div', { id: 'island' }, h('button', { title: value, onClick: () => set('changed') }, 'go'));
          }, { h: '0123456789abcdef', schema: [[]], mode: 0 }) }, document.querySelector('#app'));
          initialRecords.push(...observer.takeRecords());
          window.guard.initialWrites = initialRecords.filter(record => record.attributeName !== 'data-forma-status').map(record => record.attributeName || record.type);
          observer.disconnect();
          const dispose = mount(() => { window.guard.mounts++; return h('button', null, 'mounted'); }, document.querySelector('#mount'));
          if (mode !== 'equal') { dispose(); dispose(); }
          window.guard.retained = original === document.querySelector('#island button');
          window.guard.ready = true;
        </script></body></html>` });
    });
    await page.goto('/skew.html');
    if (mode === 'mismatch') await expect.poll(() => documents).toBe(2);
    await expect.poll(() => page.evaluate(() => (window as any).guard?.ready)).toBe(true);
    const result = await page.evaluate(() => ({ ...(window as any).guard, status: document.querySelector('#island')!.getAttribute('data-forma-status'), mount: document.querySelector('#mount')!.textContent }));
    expect(result.retained).toBe(true); expect(result.initialWrites).toEqual([]);
    if (mode === 'equal') {
      expect(result.components).toBe(1); expect(result.mounts).toBe(1); expect(result.events).toEqual([]); expect(result.status).toBeNull();
      expect(result.mount).toBe('mounted'); await page.locator('#island button').click(); await expect(page.locator('#island button')).toHaveAttribute('title', 'changed');
    } else {
      expect(result.components).toBe(0); expect(result.mounts).toBe(0); expect(result.status).toBe('skew'); expect(result.mount).toBe('preserved');
      expect(result.events).toEqual([{ page: 'page-build', bundle: 'bundle-build', reload: mode === 'cancel' || mode === 'storage-write', cancelable: true, documentTarget: true }]);
      await page.locator('#island button').click(); await expect(page.locator('#island button')).toHaveAttribute('title', 'ready');
      if (mode === 'mismatch') {
        // A third document explicitly requested by the test still cannot auto-reload.
        await page.reload(); await expect.poll(() => page.evaluate(() => (window as any).guard?.ready)).toBe(true);
        expect(documents).toBe(3); expect(await page.evaluate(() => (window as any).guard.events[0].reload)).toBe(false);
      } else expect(documents).toBe(1);
    }
  });
}
