/** FORMA-108 controls run in the same real CSP/Trusted-Types document and packed runtime. */
export async function runExplicitControls(profile) {
  const runtime = window.FormaRuntime, root = document.getElementById('root');
  const expected = ['applyContainmentHints', 'clearDiagnostics', 'getDiagnostics', 'getScopes', 'mountMarkup', 'resetScope', 'setScopeValue', 'trustedHtml', 'yieldToMain'].sort();
  if (JSON.stringify(Object.keys(runtime).sort()) !== JSON.stringify(expected)) throw new Error('explicit runtime export surface differs');
  const injected = document.createElement('section'); injected.setAttribute('data-forma-state', '{"n":2}');
  const text = document.createElement('p'); text.setAttribute('data-text', '{n}'); text.textContent = 'raw'; injected.append(text);
  document.body.append(injected); document.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 0));
  const served = document.getElementById('unowned-served').textContent;
  if (served !== 'raw' || text.textContent !== 'raw') throw new Error('runtime bound markup without an explicit root');
  injected.remove();
  const rows = [{ id: `no-auto/${profile}`, served, injected: text.textContent }];
  for (const tier of ['compiled', 'reviewed']) {
    runtime.clearDiagnostics(); window.__outsideReads = 0; window.__observeHostile = true;
    const handle = runtime.mountMarkup(root, runtime.trustedHtml(`<section data-forma-state='{}'>
      <p id="alive" data-text="{1+2}">raw</p><p id="reach" data-text="{$el.closest('[data-secret]')?.getAttribute('data-secret') ?? 'confined'}">raw</p>
      <form><button type="button" id="trigger" data-on:click="{$dispatch('submit')}">run</button></form>
      <div data-fetch="GET /api/widget/items → result |error:failed"></div><p id="failed" data-text="{failed}"></p></section>`), { tier });
    let activations = 0;
    const trigger = root.querySelector('#trigger');
    const observe = event => { activations++; event.preventDefault(); };
    trigger.addEventListener('submit', observe);
    try {
      trigger.click(); await new Promise(resolve => setTimeout(resolve, 0));
      rows.push({ id: `omitted-${tier}/${profile}`, live: root.querySelector('#alive').textContent === '3',
        reach: root.querySelector('#reach').textContent, failed: root.querySelector('#failed').textContent,
        activations, outsideReads: window.__outsideReads, codes: runtime.getDiagnostics().map(row => row.code).sort() });
    } finally { window.__observeHostile = false; trigger.removeEventListener('submit', observe); handle.unmount(); }
  }
  return rows;
}
