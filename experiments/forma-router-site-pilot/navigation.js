// Local bounded pilot wrapper. The application supplies its existing page lifecycle.
import { createHtmlAdapter, createRouter } from '@getforma/router';
const paths = ['/project/', '/releases/'];
const permitted = url => url.origin === location.origin && paths.includes(url.pathname) && !url.search;
export function startPortalNavigation({ mountPage, beforeNavigate }) {
  const root = document.querySelector('[data-portal-content]');
  if (!root) return;
  let pageController, releasePage = () => {}, router;
  const observations = { mounts: 0, disposals: 0, errors: [] };
  function release() {
    pageController?.abort(); releasePage(); releasePage = () => {};
    if (pageController) observations.disposals++;
    pageController = undefined;
  }
  async function mount() {
    const controller = new AbortController(); pageController = controller;
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (!permitted(new URL(anchor.href))) anchor.setAttribute('data-no-router', '');
    }
    const stop = await mountPage(root, { signal: controller.signal });
    if (controller.signal.aborted) stop(); else { releasePage = stop; observations.mounts++; }
  }
  const shell = new AbortController();
  async function boot() {
    if (!permitted(new URL(location.href))) { await mount(); return; }
    const response = await fetch('/forma-router-pilot.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) throw Error('pilot registry unavailable');
    const registry = await response.json();
    const build = document.querySelector('meta[name="forma-portal-build"]')?.content;
    const assets = document.querySelector('meta[name="forma-portal-assets"]')?.content;
    if (registry.build !== build || registry.assets !== assets || registry.pages.length !== paths.length || registry.pages.some(p => !paths.includes(p.path))) throw Error('pilot initial build mismatch');
    const html = createHtmlAdapter({ head: registry.head, pages: registry.pages });
    const adapter = { kind: 'html', connect(container) {
      const session = html.connect(container);
      return {
        async initialize(context) { await session.initialize(context); await mount(); },
        async prepare(context) {
          const candidate = await session.prepare(context);
          return { ...candidate,
            commit() { beforeNavigate?.(); release(); candidate.validate(); candidate.commit(); },
            async activate() { await candidate.activate(); await mount(); },
          };
        },
        invalidate() { release(); session.invalidate?.(); },
        dispose() { release(); session.dispose(); },
      };
    } };
    router = createRouter({ root, routes: paths.map(path => ({ id: path.slice(1,-1), path: path.slice(1,-1) })), adapter,
      statusRegion: document.querySelector('[data-navigation-status]'), recoveryKey: build,
      onError(code) { observations.errors.push(code); },
    });
    // Header/footer/search belong to the persistent shell, outside the router root.
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-no-router') || (anchor.target && anchor.target !== '_self') || !permitted(new URL(anchor.href))) return;
      event.preventDefault(); void router.navigate(anchor.href);
    }, { signal: shell.signal });
    await router.ready;
    window.__formaSitePilot = { router, observations, build };
  }
  void boot().catch(async error => { observations.errors.push(String(error)); if (!pageController) await mount(); window.__formaSitePilotFailure = observations; });
  window.addEventListener('pagehide', () => { shell.abort(); router?.dispose(); release(); }, { once: true });
}
