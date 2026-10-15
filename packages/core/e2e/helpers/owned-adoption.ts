import type { Page } from '@playwright/test';

/** Serve a test-only caller of the retained public API from the same core module. */
export async function serveOwnedAdoption(page: Page, coreUrl: string): Promise<void> {
  await page.route('**/test-owned-adoption.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    body: `import { createRoot, hydrateIsland } from ${JSON.stringify(coreUrl)};
export function adoptInRoot(component, container) {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) throw new Error('Test adoption target not found');
  return createRoot(dispose => {
    try { hydrateIsland(component, target); }
    catch (error) { dispose(); throw error; }
    return dispose;
  });
}`,
  }));
}
