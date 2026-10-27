import { prepareNativeOwner, prepareInitialNativeOwners, validateNativeOwnerTree } from '@getforma/core/navigation';
import { NavigationError, type ActionOutcome, type RouteAdapter, type NavigationContext } from './types';
import { BODY_LIMIT, media, parseFragment, pathOnly, readBody, record } from './transport';
export interface NavigationBootstrap {
  readonly registrations: Readonly<Record<string, (element: HTMLElement, props: Record<string, unknown> | null) => unknown>>;
  readonly app: string;
  readonly build: string;
  readonly group: string;
  readonly owners: readonly string[];
}
type NativeScope = ReturnType<typeof prepareNativeOwner>;
type Owner = { id: string; parent: string | null; contract: string; reuseKey: string; propsDigest: string; outlet: string | null; html?: string; state?: unknown };
const PAGE = 'application/vnd.forma.navigation+json';
const IDENTITIES = ['app', 'build', 'group', 'layout', 'context', 'policy', 'policyProfile'] as const;
const statuses = new Set([200, 404, 410, 500, 503]);
function ownerRecords(value: unknown, allowed: readonly string[]): Owner[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new NavigationError('ROUTER_OWNER_LIMIT');
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const item = record(raw);
    if (typeof item.id !== 'string' || !allowed.includes(item.id) || seen.has(item.id) || item.parent !== (index ? value[index - 1].id : null)) throw new NavigationError('ROUTER_OWNER_ID');
    seen.add(item.id);
    for (const key of ['contract', 'reuseKey', 'propsDigest']) if (typeof item[key] !== 'string' || !/^[a-f0-9]{64}$/.test(item[key])) throw new NavigationError('ROUTER_OWNER_DIGEST');
    if (index < value.length - 1 ? typeof item.outlet !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.outlet) : item.outlet !== null) throw new NavigationError('ROUTER_OUTLET');
    return { id: item.id, parent: item.parent, contract: item.contract, reuseKey: item.reuseKey, propsDigest: item.propsDigest, outlet: item.outlet, ...(item.html === undefined ? {} : { html: item.html, state: item.state }) };
  });
}
function outletOf(node: HTMLElement, owner: Owner, initial = false): HTMLElement | undefined {
  const candidates = [...node.querySelectorAll<HTMLElement>('[data-forma-outlet]')].filter(el => el.closest('[data-forma-owner]') === node);
  if (owner.outlet === null) { if (candidates.length) throw new NavigationError('ROUTER_OUTLET'); return undefined; }
  if (candidates.length !== 1 || candidates[0].tagName !== 'DIV' || candidates[0].getAttribute('data-forma-outlet') !== owner.outlet || (!initial && candidates[0].childNodes.length)) throw new NavigationError('ROUTER_OUTLET');
  return candidates[0];
}
function sameOwner(a: Owner, b: Owner) { return ['id', 'parent', 'contract', 'reuseKey', 'propsDigest', 'outlet'].every(k => a[k as keyof Owner] === b[k as keyof Owner]); }
function islandCount(scope: NativeScope) { return [...scope.root.querySelectorAll('[data-forma-island]')].filter(host => !scope.outlet?.contains(host)).length; }
function release(scopes: readonly NativeScope[]) {
  const errors: unknown[] = []; for (const scope of [...scopes].reverse()) try { scope.dispose(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'ROUTER_CLEANUP');
}
export function createNativeAdapter(bootstrap: NavigationBootstrap): RouteAdapter {
  const owners = Object.freeze([...bootstrap.owners]);
  const identity = Object.freeze({ app: bootstrap.app, build: bootstrap.build, group: bootstrap.group });
  const registry = Object.freeze({ ...bootstrap.registrations });
  return Object.freeze({ kind: 'native' as const, connect(container: HTMLElement) {
    const doc = container.ownerDocument;
    const metadata = [...doc.querySelectorAll('script[data-forma-navigation]')];
    if (metadata.length !== 1) throw new NavigationError('ROUTER_BOOTSTRAP');
    const text = metadata[0].textContent ?? '';
    if (text.length > BODY_LIMIT) throw new NavigationError('ROUTER_BOOTSTRAP_LIMIT');
    const initial = record(JSON.parse(text));
    for (const key of ['app', 'build', 'group', 'layout', 'context']) if (typeof initial[key] !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(initial[key])) throw new NavigationError('ROUTER_BOOTSTRAP_SCHEMA');
    if (typeof initial.policy !== 'string' || !/^[a-f0-9]{64}$/.test(initial.policy)) throw new NavigationError('ROUTER_BOOTSTRAP_SCHEMA');
    if (!Array.isArray(initial.assets) || initial.assets.length < 1 || initial.assets.length > 256 || initial.assets.filter((a: any) => a?.kind === 'script').length !== 1 || initial.assets.some((a: any) => !a || !['script', 'style', 'font'].includes(a.kind) || typeof a.url !== 'string' || !/^\/_assets\/[A-Za-z0-9_./-]{1,2048}$/.test(a.url) || a.url.split('/').some((p: string) => p === '.' || p === '..') || typeof a.integrity !== 'string' || !/^sha(?:256|384|512)-[A-Za-z0-9+/]{32,172}={0,2}$/.test(a.integrity))) throw new NavigationError('ROUTER_BOOTSTRAP_ASSETS');
    for (const key of ['app', 'build', 'group'] as const) if (initial[key] !== identity[key]) throw new NavigationError('ROUTER_BOOTSTRAP_IDENTITY', true);
    if (initial.version !== 1 || initial.policyProfile !== 'page-response-only-v1') throw new NavigationError('ROUTER_POLICY_PROFILE', true);
    if (!Array.isArray(initial.actions) || initial.actions.length > 128 || initial.actions.some((p: unknown) => typeof p !== 'string' || !pathOnly(p))) throw new NavigationError('ROUTER_ACTION_POLICY');
    const actions: string[] = [...initial.actions];
    if (new Set(actions).size !== actions.length) throw new NavigationError('ROUTER_ACTION_POLICY');
    ownerRecords(initial.owners, owners);
    let live: NativeScope[] = [], liveOwners: Owner[] = [], closed = false;
    function checkIdentity(data: Record<string, any>) {
      for (const key of IDENTITIES) if (data[key] !== initial[key]) throw new NavigationError(`ROUTER_IDENTITY_${key.toUpperCase()}`, true, key === 'context');
      if (JSON.stringify(data.assets) !== JSON.stringify(initial.assets) || JSON.stringify(data.actions) !== JSON.stringify(actions)) throw new NavigationError('ROUTER_ASSET_IDENTITY', true);
    }
    return {
      async initialize() {
        liveOwners = ownerRecords(initial.owners, owners);
        const nodes = [...container.querySelectorAll<HTMLElement>('[data-forma-owner]')];
        if (container.querySelectorAll('[data-forma-island]').length > 200) throw new NavigationError('ROUTER_ISLAND_LIMIT');
        if (nodes.length !== liveOwners.length) throw new NavigationError('ROUTER_INITIAL_OWNERS');
        live = [...prepareInitialNativeOwners(registry, liveOwners.map((owner, index) => {
          const root = nodes[index];
          if (root.getAttribute('data-forma-owner') !== owner.id || root.getAttribute('data-forma-build') !== identity.build) throw new NavigationError('ROUTER_INITIAL_OWNERS');
          return { root, outlet: outletOf(root, owner, true) };
        }))];
        validateNativeOwnerTree(live);
        await Promise.all(live.map(scope => scope.activate()));
      },
      async prepare(context: NavigationContext) {
        if (closed) throw new NavigationError('ROUTER_DISPOSED');
        const response = await fetch(context.url, { headers: { Accept: PAGE }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: context.signal });
        if ([401, 403].includes(response.status)) throw new NavigationError('ROUTER_AUTH', true, true);
        media(response, PAGE);
        const data = record(JSON.parse(await readBody(response, context.signal)));
        if (data.version !== 1 || data.status !== response.status || data.route !== context.url.pathname) throw new NavigationError('ROUTER_RESPONSE_SCHEMA');
        checkIdentity(data);
        if (data.kind === 'redirect' && response.status === 200 && typeof data.location === 'string') return { redirect: data.location };
        if (!statuses.has(response.status) || data.kind !== (response.status === 200 ? 'page' : 'error') || typeof data.title !== 'string' || data.title.length > 4096) throw new NavigationError('ROUTER_RESPONSE_STATUS');
        const nextOwners = ownerRecords(data.owners, owners);
        let keep = 0; while (keep < liveOwners.length && keep < nextOwners.length && sameOwner(liveOwners[keep], nextOwners[keep])) keep++;
        const fresh: NativeScope[] = []; let disposed = false, transferred = false;
        try {
          for (const owner of nextOwners.slice(keep)) {
            const node = parseFragment(owner.html!, doc, context.url);
            if (node.getAttribute('data-forma-owner') !== owner.id || node.getAttribute('data-forma-build') !== identity.build || !node.hasAttribute('data-forma-ssr') || node.querySelector('[data-forma-owner]')) throw new NavigationError('ROUTER_OWNER_ROOT');
            fresh.push(prepareNativeOwner(registry, node, JSON.stringify(owner.state), { outlet: outletOf(node, owner) }));
          }
          if ([...live.slice(0, keep), ...fresh].reduce((n, scope) => n + islandCount(scope), 0) > 200) throw new NavigationError('ROUTER_ISLAND_LIMIT');
          for (let i = 0; i < fresh.length - 1; i++) fresh[i].outlet!.replaceChildren(fresh[i + 1].root);
          if (fresh.length) validateNativeOwnerTree(fresh);
        } catch (error) { release(fresh); throw error; }
        function validate() {
          if (closed || disposed || context.signal.aborted) throw new NavigationError('ROUTER_CANCELLED');
          live.forEach(scope => { if (!container.contains(scope.root)) throw new NavigationError('ROUTER_OWNER_MOVED', true); scope.validate(); });
          if (live.length) validateNativeOwnerTree(live);
          if (fresh.length) validateNativeOwnerTree(fresh);
        }
        return {
          title: data.title, status: data.status, validate,
          commit() {
            validate();
            if (keep === live.length && keep === nextOwners.length) { transferred = true; liveOwners = nextOwners; return; }
            const target = keep ? live[keep - 1].outlet : container;
            if (!target) throw new NavigationError('ROUTER_OUTLET');
            release(live.slice(keep));
            if (closed || disposed || context.signal.aborted || !container.isConnected) throw new NavigationError('ROUTER_CANCELLED');
            for (const scope of live.slice(0, keep)) { if (!container.contains(scope.root)) throw new NavigationError('ROUTER_OWNER_MOVED', true); scope.validate(); }
            if (fresh.length) validateNativeOwnerTree(fresh);
            if (fresh.length) target.replaceChildren(fresh[0].root); else if (keep < live.length) target.replaceChildren();
            live = [...live.slice(0, keep), ...fresh]; liveOwners = nextOwners; transferred = true;
            validateNativeOwnerTree(live);
          },
          async activate() { await Promise.all(fresh.map(scope => scope.activate())); },
          dispose() { if (disposed || transferred) return; disposed = true; release(fresh); },
        };
      },
      allowsAction(url: URL) { return url.origin === doc.location.origin && !url.search && !url.hash && actions.includes(url.pathname); },
      admitAction(value: unknown, response: Response, url: URL): ActionOutcome {
        const data = record(value);
        if (data.version !== 1 || data.kind !== 'action' || data.endpoint !== url.pathname || data.status !== response.status) throw new NavigationError('ROUTER_ACTION_IDENTITY');
        for (const key of IDENTITIES) if (data[key] !== initial[key]) throw new NavigationError('ROUTER_ACTION_IDENTITY', false, key === 'context');
        if (JSON.stringify(data.actions) !== JSON.stringify(actions)) throw new NavigationError('ROUTER_ACTION_IDENTITY');
        const outcome = data.outcome;
        if (!['success', 'validation', 'error', 'redirect'].includes(outcome) || (outcome === 'validation' ? response.status !== 422 : outcome === 'error' ? response.status < 400 || response.status > 599 : response.status !== 200)) throw new NavigationError('ROUTER_ACTION_STATUS');
        const body = record(data.data);
        if (outcome === 'redirect' && (body.status !== 303 || typeof body.location !== 'string')) throw new NavigationError('ROUTER_ACTION_REDIRECT');
        return Object.freeze({ outcome, status: data.status, data: Object.freeze({ ...body }) });
      },
      invalidate() { try { release(live); } finally { live = []; liveOwners = []; container.replaceChildren(); } },
      dispose() { if (closed) return; closed = true; release(live); live = []; liveOwners = []; },
    };
  } });
}
