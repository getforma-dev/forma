// Local native feasibility client, not the proposed public router implementation.
// Real compiler registrations and Rust responses are required; no hand-built claims.
import { activateIslands, deactivateAllIslands } from '../../packages/core/src/dom/activate';
import { __prepareNavigationIslands } from '../../packages/core/src/dom/navigation-experiment';
import { trustedHtml, rawHtml } from '../../packages/core/src/dom/trusted-html';

type Boot = { registrations: Record<string, any>; app: string; build: string; group: string };
type Scope = ReturnType<typeof __prepareNavigationIslands>;
const PAGE = 'application/vnd.forma.navigation+json';
const ACTION = 'application/vnd.forma.action+json';
const LIMIT = 1024 * 1024;
function preflightMarkup(html: string) {
  // Strict renderer-fragment profile before any native HTML parser/import.
  const voids = new Set(['area','br','col','hr','input','wbr']);
  const forbidden = new Set(['script','iframe','object','embed','base','meta','link','style','template','img','audio','video','source','track','svg','math']);
  const stack: string[] = []; let cursor = 0, nodes = 0;
  while (cursor < html.length) {
    if (++nodes > 10000) throw new Error('markup-node-limit');
    if (html.startsWith('<!--',cursor)) { const end=html.indexOf('-->',cursor+4);if(end<0)throw new Error('markup-comment');cursor=end+3;continue; }
    if (html[cursor] !== '<') { const end=html.indexOf('<',cursor);cursor=end<0?html.length:end;continue; }
    const match=/^<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?=[\s/>])/.exec(html.slice(cursor));
    if(!match)throw new Error('markup-token');
    const name=match[1].toLowerCase();if(name.includes('-')||name.includes(':')||forbidden.has(name))throw new Error('markup-profile');
    let end=cursor+match[0].length,quote='';
    for(;end<html.length;end++){const c=html[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'"){quote=c;}else if(c==='>')break;}
    if(end===html.length)throw new Error('markup-tag');
    const token=html.slice(cursor,end+1);
    if(/(?:[\s/])(?:is|shadowrootmode|srcdoc)(?=[\s=/>])/i.test(token))throw new Error('markup-customization');
    if(html[cursor+1]==='/'){if(stack.pop()!==name)throw new Error('markup-nesting');}
    else if(!voids.has(name)){stack.push(name);if(stack.length>64)throw new Error('markup-depth');}
    cursor=end+1;
  }
  if(stack.length)throw new Error('markup-unclosed');
}
const paths = new Set(['/proof/a', '/proof/b']);
const actionPath = '/proof/update';
function eligibleAction(raw: string) {
  const url = new URL(raw, location.href);
  // The proof declares exactly one endpoint and never normalizes a different
  // author spelling into mutation authority (queries and fragments included).
  return url.origin === location.origin && !url.username && !url.password &&
    url.pathname === actionPath && !url.search && !url.hash &&
    (raw === actionPath || raw === `${url.origin}${actionPath}`) ? url : null;
}
type Uncertain = Readonly<{ version: 1; endpoint: string; reason: string; at: number }>;


async function boundedJSON(response: Response) {
  if (!response.body) throw new Error('missing-body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > LIMIT) throw new Error('body-limit');
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const joined = new Uint8Array(bytes); let at = 0;
  for (const chunk of chunks) { joined.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
}
function eligible(raw: string) {
  const url = new URL(raw, location.href);
  return url.origin === location.origin && !url.username && !url.password &&
    (url.protocol === 'http:' || url.protocol === 'https:') && paths.has(url.pathname) ? url : null;
}
function equalAssets(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

export function startProof({ registrations, app, build, group }: Boot) {
  const initial = JSON.parse(document.querySelector('script[data-forma-navigation]')?.textContent || 'null');
  if (!initial || initial.version !== 1 || initial.app !== app || initial.build !== build || initial.group !== group)
    throw new Error('initial-navigation-identity');
  let root = document.querySelector<HTMLElement>('#proof-route')!;
  const layout = document.querySelector<HTMLElement>('#proof-layout')!;
  if (!root || !layout) throw new Error('missing-proof-regions');
  const metrics = { commits: 0, cancelled: 0, disposed: 0, scopes: 0, errors: [] as string[], fallbacks: [] as string[], posts: 0 };
  let scope: Scope | undefined;
  const preparedScopes = new Set<Scope>();
  let generation = 0, mutationGeneration = 0, index = 0;
  let active: AbortController | undefined, action: AbortController | undefined;
  let actionTransmitted = false;
  let committed = new URL(location.href), disposed = false, invalidated = false, committing = false;
  let actionPhase = 'idle';
  const uncertainKey = `forma-proof-uncertain:${app}`;
  let uncertain: Uncertain | undefined;
  try {
    const stored = sessionStorage.getItem(uncertainKey);
    const value = stored && stored.length <= 512 ? JSON.parse(stored) : null;
    if (value?.version === 1 && value.endpoint === actionPath && typeof value.reason === 'string' && value.reason.length <= 160 && Number.isFinite(value.at))
      uncertain = Object.freeze({ version: 1, endpoint: actionPath, reason: value.reason, at: value.at });
  } catch { /* Storage is best effort; the current Document still keeps its latch. */ }
  let recoverDocument = (url: string, replace: boolean) => { replace ? location.replace(url) : location.assign(url); };

  const previousScrollRestoration = history.scrollRestoration;
  history.scrollRestoration = 'manual';
  const scroll = new Map<string, [number, number]>();
  const historyWrites: number[] = [performance.now()];
  async function historyPermit(signal?: AbortSignal) {
    while (true) {
      if(signal?.aborted)throw signal.reason;
      const now=performance.now();while(historyWrites.length && now-historyWrites[0]>=10000)historyWrites.shift();
      if(historyWrites.length<60){historyWrites.push(now);return;}
      await new Promise<void>((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason)};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},Math.ceil(10000-(now-historyWrites[0]))+5);
        signal?.addEventListener('abort',abort,{once:true});
      });
    }
  }
  let entry = crypto.randomUUID();
  const existingState = history.state && typeof history.state === 'object' ? history.state : {};
  history.replaceState({ ...existingState, __formaProof: { key: entry, index } }, '', location.href);
  const status = document.createElement('p');
  status.id = 'proof-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  layout.append(status);
  const errorListener = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    metrics.errors.push(String(detail?.code || detail?.message || 'forma:error'));
  };
  document.addEventListener('forma:error', errorListener);
  const ready = activateIslands(registrations);
  const uncertainMessage = 'Submission outcome unknown. Do not repeat it automatically; inspect fresh server state.';
  function announce(message: string) {
    if (!disposed && !invalidated) status.textContent = uncertain ? `${message}. ${uncertainMessage}` : message;
  }
  function recordUncertain(reason: string) {
    // One bounded, nonsecret record. No form values, action data, or credentials.
    const code = /^(?:action-[a-z-]+|context-[a-z-]+|native-incompatible-[a-z-]+|explicit-context-change|bfcache-restore)$/.test(reason) ? reason.slice(0, 160) : 'unreadable-action-response';
    uncertain = Object.freeze({ version: 1, endpoint: actionPath, reason: code, at: Date.now() });
    try { sessionStorage.setItem(uncertainKey, JSON.stringify(uncertain)); } catch { /* Current-document latch remains. */ }
  }
  function revokeOwners() {
    for (const prepared of preparedScopes) prepared.dispose();
    preparedScopes.clear();
    if (scope) { scope.dispose(); scope = undefined; metrics.scopes--; metrics.disposed++; }
    // This includes original-document deferred owners as well as visible owners.
    deactivateAllIslands(document);
  }
  function detachInterception() {
    document.removeEventListener('click', onClick); document.removeEventListener('submit', onSubmit);
    removeEventListener('popstate', onPop); removeEventListener('pageshow', onPageShow);
  }
  function invalidateContext(reason = 'explicit-context-change') {
    if (disposed || invalidated) return;
    invalidated = true; ++mutationGeneration; cancel();
    if (actionTransmitted) { recordUncertain(reason); actionPhase = 'uncertain'; }
    action?.abort(new Error('context-invalidated'));
    revokeOwners(); detachInterception(); history.scrollRestoration = previousScrollRestoration;
    // Remove all fixture-owned private DOM and its inert state before recovery.
    // Captured JS references are revoked owners, not a promise of memory erasure.
    root.replaceChildren(); layout.replaceChildren();
    document.querySelectorAll('script[data-island-state],script[data-forma-navigation]').forEach(node => node.remove());
    document.body.replaceChildren(status);
    status.textContent = `Context expired: ${reason.slice(0, 160)}. Loading a fresh document.${uncertain ? ` ${uncertainMessage}` : ''}`;
  }

  function saveScroll() { scroll.set(entry, [scrollX, scrollY]); if (scroll.size > 1000) scroll.delete(scroll.keys().next().value!); }
  function setBusy() { root.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach(x => { x.disabled = !!action; }); }
  function cancel() { ++generation; active?.abort(); active = undefined; }
  const recoveryCodes = new Set([
    'foreign-history', 'bfcache-restore', 'action-identity', 'unknown-recovery',
    ...['app', 'build', 'group', 'layout', 'context', 'policy'].flatMap(key => [`incompatible-${key}`, `action-incompatible-${key}`]),
  ]);
  function fallback(url: URL, reason: string, replace = false) {
    const code = recoveryCodes.has(reason) ? reason : 'unknown-recovery';
    if (metrics.fallbacks.length < 32) metrics.fallbacks.push(code);
    function refuse(message: string) {
      const text = `Automatic document recovery stopped: ${message}. Use an explicit refresh.`;
      if (invalidated && !disposed) status.textContent = `${text}${uncertain ? ` ${uncertainMessage}` : ''}`;
      else announce(text);
      return { kind: 'refused', reason: message };
    }
    // Fixed fixture route IDs, never pathname/query/full URL or server error text.
    const route = url.pathname === '/proof/a' ? 'a' : url.pathname === '/proof/b' ? 'b' : null;
    if (!route || url.origin !== location.origin || url.username || url.password) return refuse('unsupported recovery route');
    const identity = `${build}|${route}|${code}`;
    const key = `forma-proof-recovery:${app}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored && stored.length > 4096) return refuse('invalid recovery record');
      const record = stored ? JSON.parse(stored) : { version: 1, attempts: [] };
      if (record?.version !== 1 || !Array.isArray(record.attempts) || record.attempts.length > 32 ||
          !record.attempts.every((value: unknown) => {
            if (typeof value !== 'string' || value.length > 80) return false;
            const parts = value.split('|'); if (parts.length !== 3) return false;
            const [attemptBuild, attemptRoute, attemptCode] = parts;
            return /^[a-f0-9]{16}$/.test(attemptBuild) && ['a', 'b'].includes(attemptRoute) && recoveryCodes.has(attemptCode);
          })) return refuse('invalid recovery record');
      if (record.attempts.length >= 32) return refuse('recovery limit reached');
      if (record.attempts.includes(identity)) return refuse('repeated recovery');
      sessionStorage.setItem(key, JSON.stringify({ version: 1, attempts: [...record.attempts, identity] }));
    } catch { return refuse('recovery storage unavailable'); }
    recoverDocument(url.href, replace);
    return { kind: 'document' };
  }
  function position(url: URL, pop: boolean) {
    const saved = scroll.get(entry);
    if (pop && saved) { scrollTo(...saved); return; }
    if (url.hash) {
      let id: string; try { id = decodeURIComponent(url.hash.slice(1)); } catch { id = url.hash.slice(1); }
      document.getElementById(id)?.scrollIntoView();
    } else scrollTo(0, 0);
  }
  async function navigate(raw: string, opts: { replace?: boolean; pop?: boolean; revalidate?: boolean } = {}): Promise<any> {
    if (disposed) return { kind: 'disposed' };
    if (invalidated) return { kind: 'context-invalidated' };
    if (committing) return new Promise(resolve => queueMicrotask(() => resolve(navigate(raw, opts))));
    const url = eligible(raw);
    if (!url) return { kind: 'unsupported' };
    saveScroll();
    cancel(); const mine = generation, readGeneration = mutationGeneration;
    const samePage = url.pathname === committed.pathname && url.search === committed.search;
    if (samePage && !opts.revalidate) {
      if (url.hash !== committed.hash || opts.pop) {
        if (opts.pop) {
          const state = history.state?.__formaProof;
          if (!state) { fallback(url, 'foreign-history', true); return { kind: 'document' }; }
          entry = state.key; index = state.index;
        } else {
          await historyPermit(); if (mine !== generation || disposed) return { kind: 'cancelled' };
          entry = crypto.randomUUID(); if (!opts.replace) ++index;
          history[opts.replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), __formaProof: { key: entry, index } }, '', url.href);
        }
        committed = url; position(url, !!opts.pop);
      }
      return { kind: 'committed', hashOnly: true };
    }
    const controller = new AbortController(); active = controller;
    const timeout = setTimeout(() => controller.abort(new Error('navigation-deadline')), 15000);
    let prepared: Scope | undefined;
    announce('Loading page');
    try {
      const response = await fetch(url, { headers: { Accept: PAGE }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0] !== PAGE || !response.headers.get('cache-control')?.includes('no-store'))
        throw new Error('response-admission');
      const data = await boundedJSON(response);
      if (mine !== generation || readGeneration !== mutationGeneration || disposed) { metrics.cancelled++; return { kind: 'cancelled' }; }
      if (data.kind !== 'page' || data.version !== 1 || data.route !== url.pathname) throw new Error('response-schema');
      for (const key of ['app', 'build', 'group', 'layout', 'context', 'policy']) {
        if (data[key] !== initial[key]) { invalidateContext(`native-incompatible-${key}`); fallback(url, `incompatible-${key}`, !!opts.pop); return { kind: 'document' }; }
      }
      if (!equalAssets(data.assets, initial.assets)) throw new Error('asset-mismatch');
      if (typeof data.html !== 'string') throw new Error('html-type');
      preflightMarkup(data.html);
      const template = document.createElement('template');
      // Named raw boundary: only the validated same-origin own-build renderer's HTML.
      template.innerHTML = rawHtml(trustedHtml(data.html), 'template');
      if (template.content.querySelector('script,iframe,object,embed,base,meta,link,style')) throw new Error('forbidden-markup');
      for (const element of template.content.querySelectorAll('*')) {
        if (element.localName.includes('-') || element.localName.includes(':') || element.namespaceURI !== 'http://www.w3.org/1999/xhtml') throw new Error('custom-element-markup');
        for (const attr of element.attributes) {
          if (/^on/i.test(attr.name) || ['is', 'shadowrootmode', 'srcdoc'].includes(attr.name.toLowerCase())) throw new Error('executable-markup');
          if (['href','src','action','formaction'].includes(attr.name)) {
            const target = new URL(attr.value, url);
            if (!['http:', 'https:'].includes(target.protocol) || target.origin !== location.origin || target.username || target.password) throw new Error('unsafe-markup-url');
          }
        }
      }
      const roots = template.content.querySelectorAll<HTMLElement>('#proof-route');
      const shells = template.content.querySelectorAll<HTMLElement>('#proof-layout');
      if (roots.length !== 1 || shells.length !== 1 || roots[0].contains(shells[0]) || shells[0].contains(roots[0])) throw new Error('region-shape');
      const incoming = document.importNode(roots[0], true);
      if (incoming.querySelectorAll('[data-forma-island]').length > 200) throw new Error('island-limit');
      incoming.remove();
      prepared = __prepareNavigationIslands(registrations, incoming, JSON.stringify(data.state));
      preparedScopes.add(prepared);
      if (mine !== generation || readGeneration !== mutationGeneration || disposed) { prepared.dispose(); preparedScopes.delete(prepared); prepared = undefined; return { kind: 'cancelled' }; }
      if (!opts.pop && !opts.revalidate) await historyPermit(controller.signal);
      if (mine !== generation || readGeneration !== mutationGeneration || disposed) { prepared.dispose(); preparedScopes.delete(prepared); prepared = undefined; return { kind: 'cancelled' }; }
      committing = true;
      try {
        if (opts.pop) {
          const state = history.state?.__formaProof;
          if (!state) throw new Error('foreign-history');
          entry = state.key; index = state.index;
        } else if (!opts.revalidate) {
          entry = crypto.randomUUID(); if (!opts.replace) ++index;
          history[opts.replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), __formaProof: { key: entry, index } }, '', url.href);
        }
        if (scope) { scope.dispose(); metrics.disposed++; metrics.scopes--; } else deactivateAllIslands(root);
        root.replaceWith(incoming); root = incoming; scope = prepared; preparedScopes.delete(prepared!); prepared = undefined; metrics.scopes++;
        committed = url; document.title = String(data.title); metrics.commits++;
      } finally { committing = false; }
      await scope!.activate();
      if (mine === generation && !disposed) {
        setBusy(); const title = root.querySelector<HTMLElement>('#route-title');
        title?.setAttribute('tabindex', '-1'); title?.focus({ preventScroll: true });
        position(url, !!opts.pop); announce('Page ready');
      }
      return { kind: 'committed' };
    } catch (error) {
      if (prepared) { prepared.dispose(); preparedScopes.delete(prepared); }
      if (mine !== generation || disposed) { metrics.cancelled++; return { kind: 'cancelled' }; }
      const message = error instanceof Error ? error.message : String(error);
      announce(`Navigation failed: ${message}`); return { kind: 'failed', reason: message };
    } finally { clearTimeout(timeout); if (active === controller) active = undefined; }
  }
  function ownsForm(form: HTMLFormElement) {
    return form.ownerDocument === document && form.isConnected && root.contains(form);
  }
  async function submit(form: HTMLFormElement, submitter?: HTMLElement | null) {
    if (disposed) return { kind: 'disposed' };
    if (invalidated) return { kind: 'context-invalidated' };
    if (!ownsForm(form)) return { kind: 'stale-form' };
    if (action) return { kind: 'busy' };
    const button = submitter as HTMLButtonElement | null;
    const method = (button?.getAttribute('formmethod') || form.getAttribute('method') || 'get').toLowerCase();
    const target = button?.getAttribute('formtarget') || form.getAttribute('target');
    const rawAction = button?.getAttribute('formaction') || form.getAttribute('action') || location.href;
    let url: URL; try { url = new URL(rawAction, location.href); } catch { return { kind: 'unsupported' }; }
    const enctype = button?.getAttribute('formenctype') || form.enctype;
    if ((target && target !== '_self') || url.origin !== location.origin || url.username || url.password || !['get','post'].includes(method) ||
      !['application/x-www-form-urlencoded','multipart/form-data'].includes(enctype)) return { kind: 'unsupported' };
    if (method === 'get') {
      const values = new FormData(form, submitter as HTMLButtonElement | undefined);
      if (disposed || invalidated || !ownsForm(form)) return { kind: 'stale-form' };
      url.search = new URLSearchParams([...values].map(([k,v]) => [k, typeof v === 'string' ? v : v.name])).toString();
      return navigate(url.href);
    }
    if (!eligibleAction(rawAction)) return { kind: 'unsupported' };
    // FormData synchronously dispatches formdata. Reserve before any application
    // hook can recursively submit another form; keep submitter enabled for encoding.
    const controller = new AbortController(); action = controller; actionPhase = 'preparing';
    let transmitted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const values = new FormData(form, submitter as HTMLButtonElement | undefined);
      if (disposed) return { kind: 'disposed' };
      if (invalidated) return { kind: 'context-invalidated' };
      if (!ownsForm(form)) return { kind: 'stale-form' };
      ++mutationGeneration; cancel();
      const displayOwner = generation;
      actionPhase = 'submitting'; setBusy(); announce('Submitting');
      timer = setTimeout(() => controller.abort(new Error('action-deadline')), 30000);
      let body: FormData | URLSearchParams = values;
      if (enctype === 'application/x-www-form-urlencoded') body = new URLSearchParams([...values].map(([k,v]) => [k, typeof v === 'string' ? v : v.name]));
      metrics.posts++; transmitted = true; actionTransmitted = true;
      const response = await fetch(url, { method: 'POST', body, headers: { Accept: ACTION }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (response.headers.get('content-type')?.split(';')[0] !== ACTION || !response.headers.get('cache-control')?.includes('no-store')) throw new Error('action-response-admission');
      const data = await boundedJSON(response);
      if (disposed || invalidated) throw new Error('action-owner-revoked');
      if (data.version !== 1 || data.kind !== 'action' || !['success','validation','redirect','error'].includes(data.outcome)) throw new Error('action-schema');
      function incompatible(reason: string): never {
        invalidateContext(reason);
        // Recovery is an explicit document GET to the committed page, never the POST.
        fallback(committed, reason, true);
        throw new Error(reason);
      }
      for (const key of ['app','build','group','layout','context','policy'])
        if (data[key] !== initial[key]) incompatible(`action-incompatible-${key}`);
      if (data.endpoint !== url.pathname || data.status !== response.status) incompatible('action-identity');
      const expectedStatus = data.outcome === 'validation' ? 422 : data.outcome === 'error' ? response.status : 200;
      if(response.status !== expectedStatus || (data.outcome === 'error' && (response.status < 400 || response.status > 599))) throw new Error('action-status');
      ++mutationGeneration;
      if (data.outcome === 'validation' || data.outcome === 'error') {
        if (generation === displayOwner && form.isConnected) {
          const region = form.querySelector<HTMLElement>('#form-error') || root.querySelector<HTMLElement>('#form-error');
          if (region) { region.textContent = String(data.data?.message || 'Submission failed'); region.tabIndex = -1; region.focus(); }
          announce(data.outcome === 'validation' ? 'Please correct the form' : 'Submission refused');
        }
        return { kind: data.outcome };
      }
      actionPhase = 'revalidating'; announce('Refreshing server data');
      let destination = committed.href;
      if (data.outcome === 'redirect' && generation === displayOwner) {
        if (data.data?.status !== 303 || !eligible(data.data?.location)) throw new Error('action-redirect');
        destination = new URL(data.data.location, location.href).href;
      }
      await navigate(destination, { revalidate: destination === committed.href });
      return { kind: 'success' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!transmitted) { announce('Submission could not be prepared'); return { kind: 'failed', reason }; }
      ++mutationGeneration; actionPhase = 'uncertain'; recordUncertain(reason);
      if (invalidated) status.textContent = `Context expired. Loading a fresh document. ${uncertainMessage}`;
      else announce('Recovery available');
      return { kind: 'uncertain', reason };
    } finally {
      clearTimeout(timer);
      if (action === controller) { action = undefined; actionTransmitted = false; }
      if (actionPhase !== 'uncertain') actionPhase = 'idle'; setBusy();
    }
  }
  function onClick(event: MouseEvent) {
    if (disposed || invalidated || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = event.composedPath().find(x => x instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self') || a.hasAttribute('data-no-router') || !eligible(a.href)) return;
    event.preventDefault(); void navigate(a.href);
  }
  function onSubmit(event: SubmitEvent) {
    if (disposed || invalidated || event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
    const form = event.target; const submitter = event.submitter as HTMLButtonElement | null;
    const rawAction = submitter?.getAttribute('formaction') || form.getAttribute('action') || location.href;
    let url: URL; try { url = new URL(rawAction, location.href); } catch { return; }
    const method = (submitter?.getAttribute('formmethod') || form.method).toLowerCase();
    const target = submitter?.getAttribute('formtarget') || form.target;
    const enctype = submitter?.getAttribute('formenctype') || form.enctype;
    if (url.origin !== location.origin || url.username || url.password || (target && target !== '_self') || !['get','post'].includes(method) ||
      !['application/x-www-form-urlencoded','multipart/form-data'].includes(enctype) || form.hasAttribute('data-no-router')) return;
    if (!ownsForm(form) || (method === 'get' && !eligible(url.href)) || (method === 'post' && !eligibleAction(rawAction))) return;
    event.preventDefault(); void submit(form, submitter);
  }
  const onPop = () => { void navigate(location.href, { pop: true }); };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || disposed || invalidated) return;
    invalidateContext('bfcache-restore'); fallback(new URL(location.href), 'bfcache-restore', true);
  };
  document.addEventListener('click', onClick); document.addEventListener('submit', onSubmit); addEventListener('popstate', onPop); addEventListener('pageshow', onPageShow);
  const api = {
    ready, navigate, submit, invalidateContext, metrics, get actionPhase() { return actionPhase; },
    get invalidated() { return invalidated; },
    get uncertain() { return uncertain ? Object.freeze({ ...uncertain }) : null; },
    // Fixture-only test seam. Production recovery/auth orchestration is not implemented.
    setDocumentRecoveryForTest(recover: (url: string, replace: boolean) => void) { recoverDocument = recover; },
    requestDocumentRecoveryForTest(raw: string, code: string) { return fallback(new URL(raw, location.href), code); },
    get committed() { return committed.href; },
    dispose() {
      if (disposed) return; disposed = true; cancel();
      if (actionTransmitted) recordUncertain('action-owner-disposed');
      action?.abort(); revokeOwners(); detachInterception();
      document.removeEventListener('forma:error', errorListener);
      history.scrollRestoration = previousScrollRestoration;
    },
  };
  (window as any).__formaProof = api;
  void ready.then(() => announce('Page ready'));
  return api;
}
