import type { Page } from '@playwright/test';

/** Serve a test-only caller of the retained public API from the same core module. */
export async function serveOwnedAdoption(page: Page, coreUrl: string): Promise<void> {
  await page.route('**/test-owned-adoption.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    body: `import { createRoot, hydrateIsland, onError } from ${JSON.stringify(coreUrl)};
export function adoptInRoot(component, container) {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) throw new Error('Test adoption target not found');
  return createRoot(dispose => {
    try { hydrateIsland(component, target); }
    catch (error) { dispose(); throw error; }
    return dispose;
  });
}
export function adoptMatching(component, container) {
  const errors = [], stop = onError(error => errors.push(error));
  try {
    const dispose = adoptInRoot(component, container);
    if (errors.length) { dispose(); throw new Error('Unexpected adoption refusal: ' + errors.map(error => error.code).join(',')); }
    return dispose;
  } finally { stop(); }
}
export function adoptRefused(component, container, code) {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) throw new Error('Test adoption target not found');
  const html = target.outerHTML, nodes = [], cursor = document.createTreeWalker(target);
  for (let node = cursor.nextNode(); node; node = cursor.nextNode()) nodes.push(node);
  const records = [], observer = new MutationObserver(batch => records.push(...batch));
  observer.observe(target, {subtree:true,childList:true,attributes:true,characterData:true});
  const errors = [], stop = onError(error => errors.push(error));
  try {
    const dispose = adoptInRoot(component, target);
    const current = [], after = document.createTreeWalker(target);
    for (let node = after.nextNode(); node; node = after.nextNode()) current.push(node);
    records.push(...observer.takeRecords());
    if (errors.length !== 1 || errors[0].code !== code) { dispose(); throw new Error('Expected ' + code + ', got ' + errors.map(error => error.code).join(',')); }
    if (html !== target.outerHTML || nodes.length !== current.length || nodes.some((node,index) => node !== current[index]) || records.length) {
      dispose(); throw new Error('Refused adoption changed original DOM');
    }
    return dispose;
  } finally { stop(); observer.disconnect(); }
}`,
  }));
}
