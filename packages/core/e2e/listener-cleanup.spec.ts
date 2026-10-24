import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('ordinary element cleanup removes its listeners during dispatch and keeps external listeners', async ({ page }) => {
  await page.route('**/listener-core.mjs', route => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript',
  }));
  await page.route('**/listener.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
  }));
  await page.goto('/listener.html');
  const result = await page.evaluate(async () => {
    const { h, cleanup } = await import('/listener-core.mjs' as string);
    const calls: string[] = [];
    let button: HTMLButtonElement;
    const listener = { handleEvent() { calls.push('hover'); } };
    button = h('button', {
      onClick() { calls.push('owned'); cleanup(button); },
      onMouseover: listener,
    });
    button.addEventListener('click', () => calls.push('external'));
    document.body.appendChild(button);
    button.dispatchEvent(new Event('mouseover'));
    button.click();
    button.dispatchEvent(new Event('mouseover'));
    button.click();
    cleanup(button);
    button.remove();
    return calls;
  });
  expect(result).toEqual(['hover', 'owned', 'external', 'external']);
});
