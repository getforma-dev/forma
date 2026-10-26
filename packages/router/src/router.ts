import { createSignal } from '@getforma/core';
import { defineRoutes, matchRoutes } from './routes';
import { media, readBody } from './transport';
import { NavigationError, type Router, type RouterOptions, type LocationState, type NavigationContext, type NavigationResult, type SubmissionResult, type PreparedView, type AdapterSession, type RouteAdapter } from './types';
const STATE = '__formaRouter';
const ACTION = 'application/vnd.forma.action+json';
const unknownMessage = 'Submission outcome unknown. Check server status before submitting again.';
const documents = new WeakSet<Document>();
function abortable<T>(promise: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) late?.(value); else resolve(value); }, error => { signal.removeEventListener('abort', abort); if (!signal.aborted) reject(error); });
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
  const open = () => !closed && !invalid;
  let active: AbortController | undefined, action: AbortController | undefined, transmitted = false;
  let intended: Intent | undefined;
  let contextBarrier: Promise<void> | undefined;
  let contextCheck: AbortController | undefined, resolving: AbortController | undefined;
  async function verifiedContext(signal?: AbortSignal) {
    while (contextBarrier && open()) await (signal ? abortable(contextBarrier, signal) : contextBarrier);
  }
  let queued: { run: () => Promise<NavigationResult>; resolve: (r: NavigationResult) => void } | undefined;
  let current = entryOf(win.history.state) ?? { key: win.crypto.randomUUID(), index: 0 };
  const historyWrites: number[] = [], scroll = new Map<string, [number, number]>();
  const guards = new Set<(next: URL, signal: AbortSignal) => boolean | Promise<boolean>>();
  const sessions = new Map<RouteAdapter, AdapterSession>();
  const speculative = new Map<string, Speculation>();
  let activeAdapter = options.adapter;
  const initialMatches = matches(value().url) ?? [];
  const status = options.statusRegion ?? doc.createElement('p');
  const ownStatus = !options.statusRegion;
  if (ownStatus) { status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('data-forma-router-status', ''); root.insertAdjacentElement('afterend', status); }
  const oldRestoration = win.history.scrollRestoration; win.history.scrollRestoration = 'manual';
  const unknownKey = 'forma-router:uncertain';
  let marker: string | null = null, uncertain = false;
  try { marker = win.sessionStorage.getItem(unknownKey); uncertain = marker !== null; } catch { /* POST persistence preflight refuses unavailable storage. */ }
  if (uncertain) setMutation('uncertain');
  function announce(text: string) { if (!closed) status.textContent = uncertain ? `${text}. ${unknownMessage}` : text; }
  function report(error: unknown) { try { options.onError?.(code(error)); } catch { /* An observer cannot acquire router ownership. */ } }
  function saveScroll() { scroll.set(current.key, [win.scrollX, win.scrollY]); if (scroll.size > 1000) scroll.delete(scroll.keys().next().value!); }
  function eligible(raw: string | URL, outsideBase = false): URL | null {
    let url: URL; try { url = new URL(String(raw), value().url); } catch { return null; }
    return url.href.length <= 8192 && ['http:', 'https:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password && (outsideBase || base === '/' || url.pathname === base.slice(0, -1) || url.pathname.startsWith(base)) ? url : null;
  }
  function matches(url: URL) { return matchRoutes(routes, base === '/' ? url.pathname : '/' + url.pathname.slice(base.length)); }
  function session(adapter: RouteAdapter) { let found = sessions.get(adapter); if (!found) { found = adapter.connect(root); if (!open()) { found.dispose(); throw new NavigationError('ROUTER_CANCELLED'); } sessions.set(adapter, found); } return found; }
  function state(entry: Entry) {
    const original = win.history.state;
    return { ...(original && typeof original === 'object' ? original : {}), [STATE]: { ...entry } };
  }
  function putHistory(url: URL, replace: boolean, entry: Entry) {
    win.history[replace ? 'replaceState' : 'pushState'](state(entry), '', url.href);
    historyWrites.push(win.performance.now());
  }
  try { putHistory(value().url, true, current); } catch (error) { if (ownStatus) status.remove(); win.history.scrollRestoration = oldRestoration; throw error; }
  documents.add(doc);
  activeAdapter = initialMatches.at(-1)?.definition.adapter ?? options.adapter;
  setValue({ url: new URL(value().url), key: current.key, matches: initialMatches });
  const initialSignal = new AbortController();
  const initialAdapter = activeAdapter;
  const initialTimer = win.setTimeout(() => initialSignal.abort(new NavigationError('ROUTER_DEADLINE')), 15000);
  const ready = abortable(Promise.resolve().then(() => {
    initialSignal.signal.throwIfAborted();
    return session(initialAdapter).initialize?.({ url: new URL(value().url), matches: initialMatches, signal: initialSignal.signal, revalidate: false, location });
  }), initialSignal.signal).then(() => { if (open()) { initialized = true; announce('Page ready'); } }).catch(error => {
    try { sessions.get(initialAdapter)?.dispose(); } catch (cleanupError) { report(cleanupError); }
    throw error;
  }).finally(() => win.clearTimeout(initialTimer));
  ready.catch(error => { report(error); announce('Page setup failed. Refresh this page'); });
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
  function cancel() { const epoch = ++generation, previous = active, tasks = [...speculative.values()]; active = undefined; speculative.clear(); previous?.abort(); for (const item of tasks) item.controller.abort(); return epoch; }
  function abandon(item: Speculation) { item.controller.abort(); void item.promise.then(view => { if (!('redirect' in view)) view.dispose(); }).catch(report); }
  function clearMarker(owned: string | null) { try { if (owned === null || win.sessionStorage.getItem(unknownKey) !== owned) return false; win.sessionStorage.removeItem(unknownKey); return true; } catch { return false; } }
  function uncertainOutcome() { uncertain = true; setMutation('uncertain'); announce(unknownMessage); }
  function revoke() {
    if (invalid || closed) return;
    invalid = true; mutationGeneration++; cancel(); initialSignal.abort(); contextCheck?.abort(); resolving?.abort();
    if (transmitted) uncertainOutcome(); action?.abort();
    for (const item of sessions.values()) try { item.invalidate?.(); } catch (error) { report(error); }
    if (closed) return;
    root.replaceChildren();
    if (closed) return;
    doc.querySelectorAll('script[data-island-state],script[data-forma-navigation]').forEach(n => n.remove());
    announce('Session changed. Refresh this page');
  }
  function recover(url: URL, reason: string, replace = false): NavigationResult {
    if (closed) return { kind: 'cancelled', reason: 'disposed' };
    // One bounded journal of opaque reason/route hashes. No private search/form data is stored.
    const hash = (text: string) => { let n = 2166136261; for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619); return (n >>> 0).toString(36); };
    const identity = hash(url.pathname) + ':' + hash(reason);
    try {
      const key = 'forma-router:recovery';
      const raw = win.sessionStorage.getItem(key);
      if (raw && raw.length > 4096) throw new Error();
      const stored = raw ? JSON.parse(raw) : { build: recoveryKey, entries: [] };
      if (!stored || typeof stored !== 'object' || typeof stored.build !== 'string' || !Array.isArray(stored.entries)) throw new Error();
      const journal: unknown[] = stored.build === recoveryKey ? stored.entries : [];
      if (journal.length >= 32 || !journal.every(x => typeof x === 'string' && /^[a-z0-9:]{1,32}$/.test(x)) || journal.includes(identity)) throw new Error();
      win.sessionStorage.setItem(key, JSON.stringify({ build: recoveryKey, entries: [...journal, identity] }));
    } catch { announce('Recovery stopped. Refresh this page'); return { kind: 'failed', code: 'ROUTER_RECOVERY_LIMIT' }; }
    replace ? win.location.replace(url.href) : win.location.assign(url.href);
    return { kind: 'document-navigation', reason };
  }
  function contextChanged(reason: string) { if (open()) { revoke(); recover(value().url, reason, true); } }
  function position(url: URL, pop: boolean, retainedFocus: Element | null, isCurrent: () => boolean) {
    const focus = doc.activeElement;
    if (!retainedFocus?.isConnected || retainedFocus === doc.body || !root.contains(retainedFocus) || focus !== retainedFocus) {
      const heading = root.querySelector<HTMLElement>('[data-forma-route-heading]') ?? root.querySelector<HTMLElement>('h1,h2');
      if (heading) { if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
    if (!isCurrent()) return;
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
    if (!open()) return { kind: 'cancelled', reason: 'disposed' };
    if (committing) return new Promise(resolve => { queued?.resolve({ kind: 'cancelled', reason: 'superseded' }); queued = { run: () => run(opts.revalidate ? value().url : raw, opts), resolve }; });
    const url = eligible(raw); if (!url) return opts.pop ? recover(new URL(win.location.href), 'ROUTER_HISTORY_OUTSIDE_BASE', true) : { kind: 'failed', code: 'ROUTER_URL' };
    const taken = !opts.pop && !opts.revalidate ? speculative.get(url.href) : undefined;
    if (taken) { taken.claimed = true; speculative.delete(url.href); }
    const mine = cancel();
    if (!open() || mine !== generation) { if (taken) abandon(taken); return { kind: 'cancelled', reason: 'superseded' }; }
    const mutationAtStart = mutationGeneration, controller = new AbortController(); active = controller;
    if (taken) controller.signal.addEventListener('abort', () => taken.controller.abort(), { once: true });
    intended = { url, opts };
    const isCurrent = () => open() && generation === mine && mutationAtStart === mutationGeneration && !controller.signal.aborted;
    const timeout = win.setTimeout(() => controller.abort(new NavigationError('ROUTER_DEADLINE')), 15000);
    let candidate: PreparedView | undefined, irreversible = false, preparingAdapter = activeAdapter, usedTaken = false;
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
        setPending(target.href);
        if (!isCurrent()) return { kind: 'cancelled', reason: 'superseded' };
        root.setAttribute('aria-busy', 'true'); announce('Loading page');
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
        if (!opts.pop && !opts.revalidate) { putHistory(target, !!opts.replace, nextEntry); irreversible = true; }
        else if (target.href !== url.href) { putHistory(target, true, nextEntry); irreversible = true; }
        // Commit may release owners before throwing, even without a history write.
        irreversible = true;
        if (adapter !== activeAdapter) { sessions.get(activeAdapter)?.dispose(); sessions.delete(activeAdapter); }
        if (!isCurrent()) throw new NavigationError('ROUTER_CANCELLED');
        candidate?.commit();
        if (!isCurrent()) throw new NavigationError('ROUTER_CANCELLED');
        activeAdapter = adapter; current = nextEntry;
        setValue({ url: new URL(target), key: current.key, matches: (matched ?? []) });
        if (!isCurrent()) throw new NavigationError('ROUTER_CANCELLED');
        const title = candidate?.title ?? options.title?.(location());
        if (!isCurrent()) throw new NavigationError('ROUTER_CANCELLED');
        if (title !== undefined) doc.title = title;
        scroll.set(current.key, scroll.get(current.key) ?? [0, 0]);
      } finally {
        committing = false;
        const next = queued; queued = undefined;
        if (next) queueMicrotask(() => { void next.run().then(next.resolve); });
      }
      const activation = candidate?.activate() ?? Promise.resolve(); candidate = undefined;
      const committedLocation = location();
      await abortable(activation, controller.signal);
      if (isCurrent()) { position(target, !!opts.pop, retainedFocus, isCurrent); if (isCurrent()) announce('Page ready'); }
      return { kind: 'committed', location: committedLocation, ready: activation };
    } catch (error) {
      if (generation !== mine || closed) return { kind: 'cancelled', reason: 'superseded' };
      if (error instanceof NavigationError && error.revoke) revoke();
      const recoveryGeneration = generation, recoveryMutation = mutationGeneration;
      report(error);
      if (closed || generation !== recoveryGeneration || mutationGeneration !== recoveryMutation) return { kind: 'cancelled', reason: 'superseded' };
      if (irreversible || (error instanceof NavigationError && error.documentRecovery) || opts.pop || preparingAdapter.kind !== 'browser') return recover(url, code(error), true);
      announce('Navigation failed'); return { kind: 'failed', code: controller.signal.aborted ? 'ROUTER_DEADLINE' : code(error) };
    } finally {
      try { candidate?.dispose(); } catch (error) { report(error); }
      if (taken && !usedTaken) abandon(taken);
      win.clearTimeout(timeout);
      if (active === controller) { active = undefined; intended = undefined; setPending(undefined); if (!active) root.removeAttribute('aria-busy'); }
    }
  }
  async function prefetch(raw: string | URL): Promise<'completed' | 'skipped' | 'cancelled'> {
    const url = eligible(raw), epoch = generation;
    if (!open() || action || contextCheck || !url || !options.canPrefetch?.(new URL(url)) || win.navigator.onLine === false || (win.navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData || speculative.has(url.href) || speculative.size >= 2) return 'skipped';
    const matched = matches(url); if (!matched || !open() || epoch !== generation) return 'skipped';
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
      if (error instanceof NavigationError && error.revoke) contextChanged(code(error));
      return 'cancelled';
    } finally { win.clearTimeout(timer); if (speculative.get(url.href) === task) speculative.delete(url.href); }
  }
  function formSpec(form: HTMLFormElement, submitter?: HTMLElement) {
    const attribute = (name: string, fallback = '') => submitter?.getAttribute('form' + name) ?? form.getAttribute(name) ?? fallback;
    const actionValue = attribute('action', value().url.href);
    const method = attribute('method', 'get').toLowerCase();
    const url = eligible(actionValue, method === 'post');
    const target = attribute('target');
    const enctype = attribute('enctype', 'application/x-www-form-urlencoded');
    if (!url || (target && target !== '_self') || !['get', 'post'].includes(method) || !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(enctype) || form.hasAttribute('data-no-router') || submitter?.getAttribute('type')?.toLowerCase() === 'image') return null;
    if (method === 'post' && !session(activeAdapter).allowsAction?.(url)) return null;
    return { url, method, enctype };
  }
  async function submit(form: HTMLFormElement, submitter?: HTMLElement): Promise<SubmissionResult> {
    try { await ready; } catch { return { kind: 'unsupported' }; }
    await verifiedContext();
    if (!open()) return { kind: 'disposed' };
    if (uncertain) return { kind: 'uncertain' };
    if (!form.isConnected || !root.contains(form)) return { kind: 'unsupported' };
    if (action) return { kind: 'busy' };
    const spec = formSpec(form, submitter); if (!spec) return { kind: 'unsupported' };
    if (!form.hasAttribute('novalidate') && !submitter?.hasAttribute('formnovalidate') && !win.HTMLFormElement.prototype.reportValidity.call(form)) return { kind: 'unsupported' };
    if (!open()) return { kind: 'disposed' };
    const reservation = new AbortController(); if (spec.method === 'post') action = reservation;
    let values: FormData;
    try { values = new win.FormData(form, submitter as HTMLButtonElement | undefined); }
    catch { if (action === reservation) action = undefined; return { kind: 'unsupported' }; }
    if (!open() || !form.isConnected || !root.contains(form) || reservation.signal.aborted) { if (action === reservation) action = undefined; return { kind: 'disposed' }; }
    const urlencoded = () => new URLSearchParams([...values].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]));
    if (spec.method === 'get') { spec.url.search = urlencoded().toString(); await run(spec.url); return { kind: 'success' }; }
    mutationGeneration++; const displayOwner = cancel();
    if (!open()) { if (action === reservation) action = undefined; return { kind: 'disposed' }; }
    const ownerSession = session(activeAdapter);
    if (generation === displayOwner) intended = undefined;
    setPending(undefined);
    if (!open()) { if (action === reservation) action = undefined; return { kind: 'disposed' }; }
    const originalBusy = form.getAttribute('aria-busy');
    const restoreForm = () => { if (originalBusy === null) form.removeAttribute('aria-busy'); else form.setAttribute('aria-busy', originalBusy); };
    reservation.signal.addEventListener('abort', restoreForm, { once: true });
    form.setAttribute('aria-busy', 'true');
    setMutation('submitting'); announce('Submitting');
    const timer = win.setTimeout(() => reservation.abort(), 30000);
    let admitted = false, attempted = false;
    try {
      if (!open() || reservation.signal.aborted) return { kind: 'disposed' };
      await verifiedContext(reservation.signal);
      if (!open() || reservation.signal.aborted) return { kind: 'disposed' };
      await restoreCursor(reservation.signal);
      if (!open() || reservation.signal.aborted) return { kind: 'disposed' };
      try {
        const existing = win.sessionStorage.getItem(unknownKey);
        if (existing !== null) { marker = existing; uncertainOutcome(); return { kind: 'uncertain' }; }
        marker = win.crypto.randomUUID(); win.sessionStorage.setItem(unknownKey, marker);
      } catch { throw new NavigationError('ROUTER_UNCERTAINTY_STORAGE'); }
      transmitted = true; attempted = true;
      const response = await abortable(fetch(spec.url, { method: 'POST', body: spec.enctype === 'multipart/form-data' ? values : urlencoded(), headers: { Accept: ACTION }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: reservation.signal }), reservation.signal);
      if ([401, 403].includes(response.status)) throw new NavigationError('ROUTER_AUTH', true, true);
      media(response, ACTION); const outcome = ownerSession.admitAction!(JSON.parse(await abortable(readBody(response, reservation.signal), reservation.signal)), response, spec.url);
      if (outcome.outcome === 'redirect' && !eligible(String(outcome.data.location))) throw new NavigationError('ROUTER_ACTION_REDIRECT');
      admitted = true; transmitted = false; uncertain = !clearMarker(marker);
      if (uncertain) uncertainOutcome(); else marker = null;
      if (!open()) return { kind: 'disposed' };
      mutationGeneration++;
      const settlementGeneration = generation;
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
        if (generation === settlementGeneration && intended) void run(intended.url, intended.opts);
        return { kind: outcome.outcome, status: outcome.status, data: outcome.data };
      }
      if (!uncertain) setMutation('revalidating');
      if (!open()) return { kind: 'disposed' };
      const nextIntent = intended as Intent | undefined;
      let destination = nextIntent?.url ?? value().url;
      if (outcome.outcome === 'redirect' && generation === displayOwner) {
        const target = eligible(String(outcome.data.location)); if (!target) throw new NavigationError('ROUTER_ACTION_REDIRECT'); destination = target;
      }
      await run(destination, nextIntent ? nextIntent.opts : { revalidate: destination.href === value().url.href });
      return { kind: 'success' };
    } catch (error) {
      if (admitted) { report(error); return { kind: 'success' }; }
      if (!attempted) { report(error); return { kind: 'error', status: 0, data: { code: code(error) } }; }
      mutationGeneration++; const epoch = cancel(); if (generation === epoch) intended = undefined; setPending(undefined); uncertainOutcome();
      if (error instanceof NavigationError && error.revoke) contextChanged(code(error));
      report(error); return { kind: 'uncertain' };
    } finally {
      win.clearTimeout(timer); transmitted = false;
      reservation.signal.removeEventListener('abort', restoreForm); if (!reservation.signal.aborted) restoreForm();
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
    if (!open() || doc.visibilityState === 'hidden') return;
    if (!options.checkContext) { if (activeAdapter.kind === 'native') contextChanged('ROUTER_CONTEXT_CHECK'); return; }
    const controller = new AbortController(), previous = contextCheck; contextCheck = controller;
    const epoch = cancel(); previous?.abort();
    if (!open() || contextCheck !== controller) return;
    if (generation === epoch) intended = undefined; setPending(undefined);
    if (!open() || contextCheck !== controller) return;
    const timer = win.setTimeout(() => controller.abort(), 15000);
    const check = abortable(Promise.resolve().then(() => { controller.signal.throwIfAborted(); return options.checkContext!(controller.signal); }), controller.signal).then(async valid => {
      if (!valid && contextCheck === controller) contextChanged('ROUTER_CONTEXT_CHECK');
      else if (valid && contextCheck === controller && open()) await restoreCursor(controller.signal);
    }).catch(() => { if (contextCheck === controller) contextChanged('ROUTER_CONTEXT_CHECK'); }).finally(() => { win.clearTimeout(timer); if (contextCheck === controller) contextCheck = undefined; if (contextBarrier === check) contextBarrier = undefined; });
    contextBarrier = check;
  }
  function pageShow(event: PageTransitionEvent) { if (event.persisted) contextChanged('ROUTER_BFCACHE'); }
  let channel: BroadcastChannel | undefined;
  if (options.contextChannel && typeof win.BroadcastChannel === 'function') { channel = new win.BroadcastChannel(options.contextChannel); channel.onmessage = () => contextChanged('ROUTER_CONTEXT_CHANGE'); }
  doc.addEventListener('click', click); doc.addEventListener('submit', formEvent); doc.addEventListener('visibilitychange', foreground);
  win.addEventListener('popstate', pop); win.addEventListener('pageshow', pageShow);
  scroll.set(current.key, [win.scrollX, win.scrollY]);
  return {
    location, pending: () => pendingValue() === undefined ? undefined : new URL(pendingValue()!), mutation, ready,
    navigate: (to, opts) => run(to, opts), revalidate: () => run(value().url, { revalidate: true }), prefetch, submit,
    beforeLeave(guard) { guards.add(guard); return () => { guards.delete(guard); }; },
    invalidateContext() { if (!open()) return; channel?.postMessage('invalidate'); contextChanged('ROUTER_CONTEXT_CHANGE'); },
    async resolveUncertain(check) {
      if (!uncertain || !open() || action || resolving) return !uncertain;
      const controller = new AbortController(), epoch = mutationGeneration, owned = marker; resolving = controller;
      const timer = win.setTimeout(() => controller.abort(), 30000);
      try {
        if (!await abortable(check(controller.signal), controller.signal) || !open() || epoch !== mutationGeneration) return false;
        if (!clearMarker(owned)) return false;
        marker = null; uncertain = false; setMutation('idle'); announce('Submission status resolved'); return true;
      } catch { return false; } finally { win.clearTimeout(timer); if (resolving === controller) resolving = undefined; }
    },
    dispose() {
      if (closed) return; closed = true; cancel(); initialSignal.abort(); contextCheck?.abort(); resolving?.abort();
      root.removeAttribute('aria-busy');
      if (transmitted) uncertainOutcome(); action?.abort(); repair?.reject(); repair = undefined;
      queued?.resolve({ kind: 'cancelled', reason: 'disposed' }); queued = undefined;
      for (const item of sessions.values()) try { item.dispose(); } catch (error) { report(error); }
      sessions.clear(); guards.clear(); scroll.clear(); channel?.close();
      doc.removeEventListener('click', click); doc.removeEventListener('submit', formEvent); doc.removeEventListener('visibilitychange', foreground);
      win.removeEventListener('popstate', pop); win.removeEventListener('pageshow', pageShow);
      win.history.scrollRestoration = oldRestoration; if (ownStatus) status.remove(); documents.delete(doc);
    },
  };
}
