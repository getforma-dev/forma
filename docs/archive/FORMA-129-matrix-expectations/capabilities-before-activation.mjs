export const capabilityCases = [
  { id: 'outside', expression: "$el.closest('[data-secret]')?.getAttribute('data-secret') ?? 'confined'", allowed: 'secret-1290300', denied: 'confined' },
  { id: 'selector', expression: "$el.closest('div').querySelector('[data-secret] span') ? 'read' : 'none'", allowed: 'read', denied: 'unbound', code: 'FORMA_E_GRANT_DOM' },
  { id: 'activation', expression: "$dispatch('submit')", code: 'FORMA_E_GRANT_NAVIGATE' },
  { id: 'fetch-get', method: 'GET', path: '/api/widget/items', typical: true },
  { id: 'fetch-post', method: 'POST', path: '/api/widget/items', typical: false },
  { id: 'fetch-prefix', method: 'GET', path: '/api/widget-other/items', typical: false },
  { id: 'fetch-dot', method: 'GET', path: '/api/widget/../admin', typical: false },
  { id: 'fetch-encoded', method: 'GET', path: '/api/widget/%2fadmin', typical: false, never: true },
  { id: 'fetch-redirect', method: 'GET', path: '/api/widget/redirect', typical: true, redirect: true },
  { id: 'fetch-other-origin', method: 'GET', path: '$OTHER/api/widget/items', typical: false, other: true },
];

/** Capability positive controls intentionally exercise authority a profile
 * grants. Their permitted counts are kept separate from hostile payload zero. */
export async function runCapability({ item, profile, otherOrigin }) {
  const runtime = window.FormaRuntime;
  const root = document.getElementById('root');
  const attr = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  runtime.clearDiagnostics();
  window.__outsideReads = 0;
  window.__observeHostile = true;
  const grants = profile === 'all' ? { dom: true, navigate: true, fetch: { methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], paths: ['/', `${otherOrigin}/`], cookies: true } }
    : profile === 'typical' ? { fetch: { methods: ['GET'], paths: ['/api/widget/'], cookies: false } } : {};
  let body;
  if (item.method) body = `<div data-fetch="${attr(`${item.method} ${item.path} → result |error:failed`)}"></div><p id="result" data-text="{result?.ok}">unbound</p><p id="failed" data-text="{failed}"></p>`;
  else if (item.id === 'activation') body = `<form id="form"><button type="button" id="trigger" data-on:click="{${attr(item.expression)}}">run</button></form>`;
  else body = `<p id="out" data-text="{${attr(item.expression)}}">unbound</p><p><span></span></p>`;
  const handle = runtime.mountMarkup(root, runtime.trustedHtml(`<div data-forma-state='{}'>${body}<p id="alive" data-text="{1+2}">unbound</p></div>`), { tier: 'reviewed', grants });
  let submits = 0;
  root.addEventListener('submit', onSubmit);
  function onSubmit(event) { submits++; event.preventDefault(); }
  try {
    root.querySelector('#trigger')?.click();
    if (item.method) {
      const end = performance.now() + 3000;
      while (root.querySelector('#result').textContent !== 'true' && !root.querySelector('#failed').textContent) {
        if (performance.now() > end) throw new Error('fetch capability result did not settle');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    return { id: `${item.id}/${profile}`, live: root.querySelector('#alive')?.textContent === '3', value: root.querySelector('#out')?.textContent,
      codes: runtime.getDiagnostics().map(diagnostic => diagnostic.code), result: root.querySelector('#result')?.textContent,
      failed: root.querySelector('#failed')?.textContent, outsideReads: window.__outsideReads, submits };
  } finally { window.__observeHostile = false; root.removeEventListener('submit', onSubmit); handle.unmount(); }
}
