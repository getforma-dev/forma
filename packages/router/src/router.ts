import { createSignal } from '@getforma/core';
import { defineRoutes, matchRoutes } from './routes';
import { media, readBody } from './transport';
import { NavigationError, type Router, type RouterOptions, type LocationState, type NavigationContext, type NavigationResult, type SubmissionResult, type PreparedView, type AdapterSession, type RouteAdapter } from './types';
const STATE = '__formaRouter';
const ACTION = 'application/vnd.forma.action+json';
const unknownMessage = 'Submission outcome unknown. Do not repeat it automatically; use server status to resolve it.';
const documents = new WeakSet<Document>();
function abortable<T>(promise: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let aborted = signal.aborted;
    const abort = () => { aborted = true; reject(signal.reason); };
    if (aborted) reject(signal.reason); else signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); if (aborted) late?.(value); else resolve(value); }, error => { signal.removeEventListener('abort', abort); if (!aborted) reject(error); });
  });
}
type Entry = { key: string; index: number };
type NavigateOptions = { replace?: boolean; pop?: boolean; revalidate?: boolean };
type Intent = { url: URL; opts: NavigateOptions };
type Speculation = { controller: AbortController; promise: Promise<PreparedView | { redirect: string }>; claimed: boolean };
function entryOf(value: unknown): Entry | null {
  const item = value && typeof value === 'object' ? (value as any)[STATE] : null;
  return item && typeof item.key === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(item.key) && Number.isSafeInteger(item.index) && item.index >= 0 ? { key: item.key, index: item.index } : null;
}
function snapshot(value: LocationState): LocationState {
  return Object.freeze({ url: new URL(value.url), key: value.key, matches: Object.freeze(value.matches.map(m => Object.freeze({ id: m.id, params: Object.freeze(Object.assign(Object.create(null), m.params)) }))) });
}
function code(error: unknown) { return error instanceof NavigationError ? error.code : 'ROUTER_UNEXPECTED'; }
/** One coordinator per Document. Private/native response cache capacity is deliberately zero. */
export function createRouter(input: RouterOptions): Router {
  const options = Object.freeze({ ...input });
  const root = options.root, doc = root.ownerDocument, win = doc.defaultView!;
  if (!win || !root.isConnected || documents.has(doc)) throw new NavigationError('ROUTER_ROOT');
  const routes = defineRoutes(options.routes);
  const base = options.base ?? '/';
  if (!base.startsWith('/') || !base.endsWith('/') || base.includes('//') || /[?#%\\]/.test(base)) throw new NavigationError('ROUTER_BASE');
  const origin = new URL(doc.location.href).origin;
  const recoveryKey = options.recoveryKey ?? 'default';
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(recoveryKey)) throw new NavigationError('ROUTER_RECOVERY_KEY');
  const [value, setValue] = createSignal<LocationState>({ url: new URL(doc.location.href), key: '', matches: [] });
  const [pendingValue, setPending] = createSignal<string | undefined>(undefined);
  const [mutation, setMutation] = createSignal<'idle' | 'submitting' | 'revalidating' | 'uncertain'>('idle');
  const location = () => snapshot(value());
  let closed = false, invalid = false, initialized = false, committing = false, generation = 0, mutationGeneration = 0;
  let active: AbortController | undefined, action: AbortController | undefined, transmitted = false;
  let intended: Intent | undefined;
  let contextBarrier: Promise<void> | undefined;
  let contextCheck: AbortController | undefined;
  async function verifiedContext(signal?: AbortSignal) {
    while (contextBarrier && !closed && !invalid) await (signal ? abortable(contextBarrier, signal) : contextBarrier);
  }
  let queued: { run: () => Promise<NavigationResult>; resolve: (r: NavigationResult) => void } | undefined;
  let current = entryOf(win.history.state) ?? { key: win.crypto.randomUUID(), index: 0 };
  const historyWrites: number[] = [], scroll = new Map<string, [number, number]>();
  const guards = new Set<(next: URL, signal: AbortSignal) => boolean | Promise<boolean>>();
  const sessions = new Map<RouteAdapter, AdapterSession>();
  const speculative = new Map<string, Speculation>();
  let activeAdapter = options.adapter;
  const status = options.statusRegion ?? doc.createElement('p');
  const ownStatus = !options.statusRegion;
  if (ownStatus) { status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('data-forma-router-status', ''); root.insertAdjacentElement('afterend', status); }
  const oldRestoration = win.history.scrollRestoration; win.history.scrollRestoration = 'manual';
  const unknownKey = 'forma-router:uncertain';
  let uncertain = false;
  try { uncertain = win.sessionStorage.getItem(unknownKey) === '1'; } catch { /* Current-document latch remains usable. */ }
  function announce(text: string) { if (!closed) status.textContent = uncertain ? `${text}. ${unknownMessage}` : text; }
  function report(error: unknown) { try { options.onError?.(code(error)); } catch { /* An observer cannot acquire router ownership. */ } }
  function saveScroll() { scroll.set(current.key, [win.scrollX, win.scrollY]); if (scroll.size > 1000) scroll.delete(scroll.keys().next().value!); }
  function eligible(raw: string | URL, outsideBase = false): URL | null {
    let url: URL; try { url = new URL(String(raw), value().url); } catch { return null; }
    return url.href.length <= 8192 && ['http:', 'https:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password && (outsideBase || base === '/' || url.pathname === base.slice(0, -1) || url.pathname.startsWith(base)) ? url : null;
  }
  function matches(url: URL) { return matchRoutes(routes, base === '/' ? url.pathname : '/' + url.pathname.slice(base.length)); }
  function session(adapter: RouteAdapter) { let found = sessions.get(adapter); if (!found) { found = adapter.connect(root); sessions.set(adapter, found); } return found; }
  function state(entry: Entry) {
    const original = win.history.state;
    return { ...(original && typeof original === 'object' ? original : {}), [STATE]: { ...entry } };
  }
  function putHistory(url: URL, replace: boolean, entry: Entry) {
    win.history[replace ? 'replaceState' : 'pushState'](state(entry), '', url.href);
    historyWrites.push(win.performance.now());
  }
  const initialMatches = matches(value().url) ?? [];
  try { putHistory(value().url, true, current); } catch (error) { if (ownStatus) status.remove(); win.history.scrollRestoration = oldRestoration; throw error; }
  documents.add(doc);
  activeAdapter = initialMatches.at(-1)?.definition.adapter ?? options.adapter;
  setValue({ url: new URL(value().url), key: current.key, matches: initialMatches.map(m => ({ id: m.id, params: m.params })) });
  const initialSignal = new AbortController();
  const initialAdapter = activeAdapter;
  const initialTimer = win.setTimeout(() => initialSignal.abort(new NavigationError('ROUTER_DEADLINE')), 15000);
  const ready = abortable(Promise.resolve().then(() => {
    initialSignal.signal.throwIfAborted();
    return session(initialAdapter).initialize?.({ url: new URL(value().url), matches: initialMatches, signal: initialSignal.signal, revalidate: false, location });
  }), initialSignal.signal).then(() => { if (!closed && !invalid) { initialized = true; announce('Page ready'); } }).catch(error => {
    try { sessions.get(initialAdapter)?.dispose(); } catch (cleanupError) { report(cleanupError); }
    throw error;
  }).finally(() => win.clearTimeout(initialTimer));
  ready.catch(error => { report(error); announce('Page could not become interactive. Use a fresh document'); });
  async function permit(signal: AbortSignal) {
    while (true) {
      signal.throwIfAborted();
      const now = win.performance.now(); while (historyWrites.length && now - historyWrites[0] >= 10000) historyWrites.shift();
      if (historyWrites.length < 60) return;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { win.clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        const timer = win.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.ceil(10000 - (now - historyWrites[0])) + 5);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
  function cancel() { generation++; active?.abort(); active = undefined; for (const item of speculative.values()) item.controller.abort(); speculative.clear(); }
  function uncertainOutcome() { uncertain = true; try { win.sessionStorage.setItem(unknownKey, '1'); } catch { /* Persist in current document. */ } setMutation('uncertain'); announce(unknownMessage); }
  function revoke() {
    if (invalid || closed) return;
    invalid = true; mutationGeneration++; cancel(); initialSignal.abort(); contextCheck?.abort();
    if (transmitted) uncertainOutcome(); action?.abort();
    for (const item of sessions.values()) try { item.invalidate?.(); } catch (error) { report(error); }
    root.replaceChildren();
    doc.querySelectorAll('script[data-island-state],script[data-forma-navigation]').forEach(n => n.remove());
    announce('Session context changed. Load a fresh document');
  }
  function recover(url: URL, reason: string, replace = false): NavigationResult {
    // One bounded journal of opaque reason/route hashes. No private search/form data is stored.
    const hash = (text: string) => { let n = 2166136261; for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619); return (n >>> 0).toString(36); };
    const identity = hash(url.pathname) + ':' + hash(reason);
    try {
      const key = 'forma-router:recovery';
      const raw = win.sessionStorage.getItem(key);
      if (raw && raw.length > 4096) throw new Error();
      const stored = raw ? JSON.parse(raw) : { build: recoveryKey, entries: [] };
      if (!stored || typeof stored !== 'object' || typeof stored.build !== 'string' || !Array.isArray(stored.entries)) throw new Error();
      const journal: unknown = stored.build === recoveryKey ? stored.entries : [];
      if (!Array.isArray(journal) || journal.length >= 32 || !journal.every(x => typeof x === 'string' && /^[a-z0-9:]{1,32}$/.test(x)) || journal.includes(identity)) throw new Error();
      win.sessionStorage.setItem(key, JSON.stringify({ build: recoveryKey, entries: [...journal, identity] }));
    } catch { announce('Automatic recovery stopped. Use an explicit refresh'); return { kind: 'failed', code: 'ROUTER_RECOVERY_LIMIT' }; }
    replace ? win.location.replace(url.href) : win.location.assign(url.href);
    return { kind: 'document-navigation', reason };
  }
  function position(url: URL, pop: boolean, retainedFocus: Element | null) {
    const focus = doc.activeElement;
    if (!retainedFocus?.isConnected || retainedFocus === doc.body || !root.contains(retainedFocus) || focus !== retainedFocus) {
      const heading = root.querySelector<HTMLElement>('[data-forma-route-heading]') ?? root.querySelector<HTMLElement>('h1,h2');
      if (heading) { if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
    if (pop && scroll.has(current.key)) win.scrollTo(...scroll.get(current.key)!);
    else if (url.hash) { let id = url.hash.slice(1); try { id = decodeURIComponent(id); } catch { /* literal fragment */ } doc.getElementById(id)?.scrollIntoView(); }
    else win.scrollTo(0, 0);
  }
  let repair: { target: Entry; resolve: () => void; reject: () => void } | undefined;
  let repairing: Promise<void> | undefined;
  async function repairPop() {
    const visible = entryOf(win.history.state);
    if (!visible || !scroll.has(visible.key) || visible.index === current.index) throw new NavigationError('ROUTER_HISTORY_FOREIGN', true);
    const promise = new Promise<void>((resolve, reject) => {
      const timer = win.setTimeout(() => { repair = undefined; reject(new NavigationError('ROUTER_HISTORY_REPAIR', true)); }, 15000);
      repair = { target: current, resolve() { win.clearTimeout(timer); resolve(); }, reject() { win.clearTimeout(timer); reject(new NavigationError('ROUTER_HISTORY_REPAIR', true)); } };
      win.history.go(current.index - visible.index);
    });
    repairing = promise;
    try { await promise; } finally { if (repairing === promise) repairing = undefined; }
  }
  async function restoreCursor(signal?: AbortSignal) {
    if (repairing) await (signal ? abortable(repairing, signal) : repairing);
    if (entryOf(win.history.state)?.key !== current.key) await (signal ? abortable(repairPop(), signal) : repairPop());
  }
  async function run(raw: string | URL, opts: NavigateOptions = {}): Promise<NavigationResult> {
    if (closed || invalid) return { kind: 'cancelled', reason: 'disposed' };
    if (committing) return new Promise(resolve => { queued?.resolve({ kind: 'cancelled', reason: 'superseded' }); queued = { run: () => run(raw, opts), resolve }; });
    const url = eligible(raw); if (!url) return opts.pop ? recover(new URL(win.location.href), 'ROUTER_HISTORY_OUTSIDE_BASE', true) : { kind: 'failed', code: 'ROUTER_URL' };
    const taken = !opts.pop && !opts.revalidate ? speculative.get(url.href) : undefined;
    if (taken) { taken.claimed = true; speculative.delete(url.href); }
    cancel(); const mine = generation, mutationAtStart = mutationGeneration, controller = new AbortController(); active = controller;
    if (taken) controller.signal.addEventListener('abort', () => taken.controller.abort(), { once: true });
    intended = { url, opts };
    const isCurrent = () => !closed && !invalid && generation === mine && mutationAtStart === mutationGeneration && !controller.signal.aborted;
    const timeout = win.setTimeout(() => controller.abort(new NavigationError('ROUTER_DEADLINE')), 15000);
    let candidate: PreparedView | undefined, wroteHistory = false, preparingAdapter = activeAdapter, usedTaken = false;
    const selected = opts.pop ? entryOf(win.history.state) : null;
    try {
      await abortable(ready, controller.signal);
      await verifiedContext(controller.signal);
      if (repairing) await abortable(repairing, controller.signal);
      if (opts.revalidate) await restoreCursor(controller.signal);
      if (!isCurrent()) return { kind: 'cancelled', reason: 'superseded' };
      if (opts.pop && (!selected || !scroll.has(selected.key))) return recover(url, 'ROUTER_HISTORY_FOREIGN', true);
      if (!opts.revalidate && url.href === value().url.href && !opts.pop) return { kind: 'cancelled', reason: 'unchanged' };
      for (const guard of guards) {
        const allowed = await abortable(Promise.resolve(guard(new URL(url), controller.signal)), controller.signal);
        if (!isCurrent()) return { kind: 'cancelled', reason: 'superseded' };
        if (!allowed) { if (opts.pop) await repairPop(); return { kind: 'blocked' }; }
      }
      saveScroll();
      const hashOnly = url.pathname === value().url.pathname && url.search === value().url.search && !opts.revalidate;
      let target = url, matched = matches(target), adapter = activeAdapter;
      if (!hashOnly) {
        setPending(target.href); root.setAttribute('aria-busy', 'true'); announce('Loading page');
        const visited = new Set<string>();
        for (let hops = 0; ; hops++) {
          if (!isCurrent()) return { kind: 'cancelled', reason: 'superseded' };
          if (hops > 8 || visited.has(target.href)) throw new NavigationError('ROUTER_REDIRECT_LIMIT');
          visited.add(target.href); matched = matches(target);
          if (!matched) return recover(target, 'ROUTER_NOT_CONFIGURED', !!opts.pop);
          adapter = matched.at(-1)?.definition.adapter ?? options.adapter;
          if (adapter !== activeAdapter && (adapter.kind !== 'browser' || activeAdapter.kind !== 'browser')) return recover(target, 'ROUTER_ADAPTER_BOUNDARY', !!opts.pop);
          const context: NavigationContext = { url: new URL(target), matches: matched, signal: controller.signal, revalidate: !!opts.revalidate, location };
          preparingAdapter = adapter;
          const preparation = taken && !usedTaken && target.href === url.href ? (usedTaken = true, taken.promise) : session(adapter).prepare(context);
          const prepared = await abortable(preparation, controller.signal, item => { if (!('redirect' in item)) try { item.dispose(); } catch (error) { report(error); } });
          if ('redirect' in prepared) { const next = eligible(prepared.redirect); if (!next) throw new NavigationError('ROUTER_REDIRECT_URL'); target = next; continue; }
          candidate = prepared; break;
        }
      }
      if (!isCurrent()) return { kind: 'cancelled', reason: 'superseded' };
      candidate?.validate();
      if (!opts.pop && !opts.revalidate || target.href !== url.href) await permit(controller.signal);
      if (!isCurrent()) return { kind: 'cancelled', reason: 'superseded' };
      candidate?.validate();
      if (!isCurrent()) return { kind: 'cancelled', reason: 'superseded' };
      const retainedFocus = doc.activeElement;
      committing = true;
      try {
        const visible = entryOf(win.history.state);
        if (!visible || !scroll.has(visible.key)) throw new NavigationError('ROUTER_HISTORY_FOREIGN', true);
        const nextEntry = opts.pop ? selected! : opts.revalidate ? current : { key: win.crypto.randomUUID(), index: visible.index + (opts.replace ? 0 : 1) };
        if (!opts.pop && !opts.revalidate) { putHistory(target, !!opts.replace, nextEntry); wroteHistory = true; }
        else if (target.href !== url.href) { putHistory(target, true, nextEntry); wroteHistory = true; }
        if (adapter !== activeAdapter) { sessions.get(activeAdapter)?.dispose(); sessions.delete(activeAdapter); }
        candidate?.commit();
        if (!isCurrent()) throw new NavigationError('ROUTER_CANCELLED');
        activeAdapter = adapter; current = nextEntry;
        setValue({ url: new URL(target), key: current.key, matches: (matched ?? []).map(m => ({ id: m.id, params: m.params })) });
        if (!isCurrent()) throw new NavigationError('ROUTER_CANCELLED');
        if (candidate?.title !== undefined) doc.title = candidate.title;
        else if (options.title) doc.title = options.title(location());
        scroll.set(current.key, scroll.get(current.key) ?? [0, 0]);
      } finally {
        committing = false;
        const next = queued; queued = undefined;
        if (next) queueMicrotask(() => { void next.run().then(next.resolve); });
      }
      const activation = candidate?.activate() ?? Promise.resolve(); candidate = undefined;
      const committedLocation = location();
      await abortable(activation, controller.signal);
      if (isCurrent()) { position(target, !!opts.pop, retainedFocus); announce('Page ready'); }
      return { kind: 'committed', location: committedLocation, ready: activation };
    } catch (error) {
      if (generation !== mine || closed) return { kind: 'cancelled', reason: 'superseded' };
      if (error instanceof NavigationError && error.revoke) revoke();
      report(error);
      if (wroteHistory || (error instanceof NavigationError && error.documentRecovery) || opts.pop || preparingAdapter.kind !== 'browser') return recover(url, code(error), true);
      announce('Navigation failed'); return { kind: 'failed', code: controller.signal.aborted ? 'ROUTER_DEADLINE' : code(error) };
    } finally {
      try { candidate?.dispose(); } catch (error) { report(error); }
      if (taken && !usedTaken) { taken.controller.abort(); void taken.promise.then(item => { if (!('redirect' in item)) item.dispose(); }).catch(report); }
      win.clearTimeout(timeout);
      if (active === controller) { active = undefined; intended = undefined; setPending(undefined); root.removeAttribute('aria-busy'); }
    }
  }
  async function prefetch(raw: string | URL): Promise<'completed' | 'skipped' | 'cancelled'> {
    const url = eligible(raw);
    if (closed || invalid || action || contextBarrier || !url || !options.canPrefetch?.(new URL(url)) || win.navigator.onLine === false || (win.navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData || speculative.has(url.href) || speculative.size >= 2) return 'skipped';
    const matched = matches(url); if (!matched || closed || invalid) return 'skipped';
    const adapter = matched.at(-1)?.definition.adapter ?? options.adapter;
    if (adapter.kind === 'browser') return 'skipped';
    const controller = new AbortController();
    const task: Speculation = { controller, claimed: false, promise: Promise.resolve().then(async () => {
      await abortable(ready, controller.signal); controller.signal.throwIfAborted();
      const promise = session(adapter).prepare({ url: new URL(url), matches: matched, signal: controller.signal, revalidate: false, location });
      return abortable(promise, controller.signal, view => { if (!('redirect' in view)) try { view.dispose(); } catch (error) { report(error); } });
    }) };
    speculative.set(url.href, task);
    const timer = win.setTimeout(() => controller.abort(), 15000);
    try {
      const view = await task.promise;
      if (!task.claimed && !('redirect' in view)) view.dispose();
      return 'completed';
    } catch (error) {
      if (error instanceof NavigationError && error.revoke && !closed) { revoke(); recover(value().url, code(error), true); }
      return 'cancelled';
    } finally { win.clearTimeout(timer); if (speculative.get(url.href) === task) speculative.delete(url.href); }
  }
  function formSpec(form: HTMLFormElement, submitter?: HTMLElement) {
    const actionValue = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? value().url.href;
    const method = (submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'get').toLowerCase();
    const url = eligible(actionValue, method === 'post');
    const target = submitter?.getAttribute('formtarget') ?? form.getAttribute('target');
    const enctype = submitter?.getAttribute('formenctype') ?? form.getAttribute('enctype') ?? 'application/x-www-form-urlencoded';
    if (!url || (target && target !== '_self') || !['get', 'post'].includes(method) || !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(enctype) || form.hasAttribute('data-no-router') || submitter?.getAttribute('type')?.toLowerCase() === 'image') return null;
    if (method === 'post' && !session(activeAdapter).allowsAction?.(url)) return null;
    return { url, method, enctype };
  }
  async function submit(form: HTMLFormElement, submitter?: HTMLElement): Promise<SubmissionResult> {
    try { await ready; } catch { return { kind: 'unsupported' }; }
    await verifiedContext();
    if (closed || invalid) return { kind: 'disposed' };
    if (uncertain) return { kind: 'uncertain' };
    if (!form.isConnected || !root.contains(form)) return { kind: 'unsupported' };
    if (action) return { kind: 'busy' };
    const spec = formSpec(form, submitter); if (!spec) return { kind: 'unsupported' };
    if (!form.hasAttribute('novalidate') && !submitter?.hasAttribute('formnovalidate') && !win.HTMLFormElement.prototype.reportValidity.call(form)) return { kind: 'unsupported' };
    const reservation = new AbortController(); if (spec.method === 'post') action = reservation;
    let values: FormData;
    try { values = new win.FormData(form, submitter as HTMLButtonElement | undefined); }
    catch { if (action === reservation) action = undefined; return { kind: 'unsupported' }; }
    if (closed || invalid || !form.isConnected || !root.contains(form) || reservation.signal.aborted) { if (action === reservation) action = undefined; return { kind: 'disposed' }; }
    const urlencoded = () => new URLSearchParams([...values].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]));
    if (spec.method === 'get') { spec.url.search = urlencoded().toString(); await run(spec.url); return { kind: 'success' }; }
    mutationGeneration++; cancel(); const displayOwner = generation, ownerSession = session(activeAdapter);
    intended = undefined; setPending(undefined);
    const originalBusy = form.getAttribute('aria-busy'); form.setAttribute('aria-busy', 'true');
    setMutation('submitting'); announce('Submitting');
    const timer = win.setTimeout(() => reservation.abort(), 30000);
    let admitted = false, attempted = false;
    try {
      await verifiedContext(reservation.signal);
      await restoreCursor(reservation.signal);
      if (closed || invalid || reservation.signal.aborted) return { kind: 'disposed' };
      transmitted = true; attempted = true;
      const response = await abortable(fetch(spec.url, { method: 'POST', body: spec.enctype === 'multipart/form-data' ? values : urlencoded(), headers: { Accept: ACTION }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: reservation.signal }), reservation.signal);
      if ([401, 403].includes(response.status)) throw new NavigationError('ROUTER_AUTH', true, true);
      media(response, ACTION); const outcome = ownerSession.admitAction!(JSON.parse(await abortable(readBody(response, reservation.signal), reservation.signal)), response, spec.url);
      if (outcome.outcome === 'redirect' && !eligible(String(outcome.data.location))) throw new NavigationError('ROUTER_ACTION_REDIRECT');
      admitted = true; transmitted = false;
      if (closed || invalid) return { kind: 'disposed' };
      const nextIntent = intended as Intent | undefined;
      mutationGeneration++;
      if (outcome.outcome === 'validation' || outcome.outcome === 'error') {
        if (generation === displayOwner && form.isConnected && root.contains(form)) {
          try { options.onAction?.(outcome, form); } catch (error) { report(error); }
          if (generation === displayOwner && form.isConnected) {
            const summary = form.querySelector<HTMLElement>('[data-forma-form-error]');
            if (summary) { summary.textContent = typeof outcome.data.message === 'string' ? outcome.data.message : 'Submission refused'; summary.tabIndex = -1; summary.focus(); }
            announce(outcome.outcome === 'validation' ? 'Please correct the form' : 'Submission refused');
          }
        }
        // A settlement invalidates older reads, but must not discard a newer destination.
        if (nextIntent) void run(nextIntent.url, nextIntent.opts);
        return { kind: outcome.outcome, status: outcome.status, data: outcome.data };
      }
      setMutation('revalidating');
      let destination = nextIntent?.url ?? value().url;
      if (outcome.outcome === 'redirect' && generation === displayOwner) {
        const target = eligible(String(outcome.data.location)); if (!target) throw new NavigationError('ROUTER_ACTION_REDIRECT'); destination = target;
      }
      await run(destination, nextIntent ? nextIntent.opts : { revalidate: destination.href === value().url.href });
      return { kind: 'success' };
    } catch (error) {
      if (admitted) { report(error); return { kind: 'success' }; }
      if (!attempted) { report(error); return { kind: 'error', status: 0, data: { code: code(error) } }; }
      mutationGeneration++; cancel(); intended = undefined; setPending(undefined); uncertainOutcome();
      if (error instanceof NavigationError && error.revoke) { revoke(); recover(value().url, code(error), true); }
      report(error); return { kind: 'uncertain' };
    } finally {
      win.clearTimeout(timer); transmitted = false;
      if (originalBusy === null) form.removeAttribute('aria-busy'); else form.setAttribute('aria-busy', originalBusy);
      if (action === reservation) action = undefined;
      if (mutation() !== 'uncertain') setMutation('idle');
    }
  }
  function click(event: MouseEvent) {
    if (!initialized || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(n => n instanceof win.HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!anchor || !root.contains(anchor) || anchor.hasAttribute('download') || anchor.hasAttribute('data-no-router') || (anchor.target && anchor.target !== '_self') || !eligible(anchor.href)) return;
    event.preventDefault(); void run(anchor.href);
  }
  function formEvent(event: SubmitEvent) {
    if (!initialized || event.defaultPrevented || !(event.target instanceof win.HTMLFormElement) || !root.contains(event.target) || !formSpec(event.target, event.submitter ?? undefined)) return;
    event.preventDefault(); void submit(event.target, event.submitter ?? undefined);
  }
  function pop() {
    if (repair) { const pending = repair; repair = undefined; entryOf(win.history.state)?.key === pending.target.key ? pending.resolve() : pending.reject(); return; }
    void run(win.location.href, { pop: true });
  }
  function foreground() {
    if (closed || invalid || doc.visibilityState === 'hidden') return;
    if (!options.checkContext) { if (activeAdapter.kind === 'native') { revoke(); recover(value().url, 'ROUTER_CONTEXT_CHECK', true); } return; }
    cancel(); intended = undefined; setPending(undefined);
    contextCheck?.abort(); const controller = new AbortController(); contextCheck = controller;
    const timer = win.setTimeout(() => controller.abort(), 15000);
    const check = abortable(Promise.resolve().then(() => options.checkContext!(controller.signal)), controller.signal).then(async valid => {
      if (!valid && contextCheck === controller && !closed) { revoke(); recover(value().url, 'ROUTER_CONTEXT_CHECK', true); }
      else if (valid && contextCheck === controller && !closed && !invalid) await restoreCursor(controller.signal);
    }).catch(() => { if (contextCheck === controller && !closed) { revoke(); recover(value().url, 'ROUTER_CONTEXT_CHECK', true); } }).finally(() => { win.clearTimeout(timer); if (contextBarrier === check) contextBarrier = undefined; });
    contextBarrier = check;
  }
  function pageShow(event: PageTransitionEvent) { if (event.persisted) { revoke(); recover(value().url, 'ROUTER_BFCACHE', true); } }
  let channel: BroadcastChannel | undefined;
  if (options.contextChannel && typeof win.BroadcastChannel === 'function') { channel = new win.BroadcastChannel(options.contextChannel); channel.onmessage = () => { revoke(); recover(value().url, 'ROUTER_CONTEXT_CHANGE', true); }; }
  doc.addEventListener('click', click); doc.addEventListener('submit', formEvent); doc.addEventListener('visibilitychange', foreground);
  win.addEventListener('popstate', pop); win.addEventListener('pageshow', pageShow);
  scroll.set(current.key, [win.scrollX, win.scrollY]);
  return {
    location, pending: () => pendingValue() === undefined ? undefined : new URL(pendingValue()!), mutation, ready,
    navigate: (to, opts) => run(to, opts), revalidate: () => run(value().url, { revalidate: true }), prefetch, submit,
    beforeLeave(guard) { guards.add(guard); return () => { guards.delete(guard); }; },
    invalidateContext() { channel?.postMessage('invalidate'); revoke(); recover(value().url, 'ROUTER_CONTEXT_CHANGE', true); },
    async resolveUncertain(check) {
      if (!uncertain || closed || invalid || action) return !uncertain;
      const controller = new AbortController(), epoch = mutationGeneration;
      const timer = win.setTimeout(() => controller.abort(), 30000);
      try {
        if (!await abortable(check(controller.signal), controller.signal) || closed || invalid || epoch !== mutationGeneration) return false;
        try { win.sessionStorage.removeItem(unknownKey); } catch { return false; }
        uncertain = false; setMutation('idle'); announce('Submission status resolved'); return true;
      } catch { return false; } finally { win.clearTimeout(timer); }
    },
    dispose() {
      if (closed) return; closed = true; cancel(); initialSignal.abort(); contextCheck?.abort();
      documents.delete(doc); root.removeAttribute('aria-busy');
      if (transmitted) uncertainOutcome(); action?.abort(); repair?.reject(); repair = undefined;
      queued?.resolve({ kind: 'cancelled', reason: 'disposed' }); queued = undefined;
      for (const item of sessions.values()) try { item.dispose(); } catch (error) { report(error); }
      sessions.clear(); guards.clear(); scroll.clear(); channel?.close();
      doc.removeEventListener('click', click); doc.removeEventListener('submit', formEvent); doc.removeEventListener('visibilitychange', foreground);
      win.removeEventListener('popstate', pop); win.removeEventListener('pageshow', pageShow);
      win.history.scrollRestoration = oldRestoration; if (ownStatus) status.remove();
    },
  };
}
