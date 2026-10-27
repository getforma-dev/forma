import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNativeAdapter, type AdapterSession, type NavigationContext, type PreparedView } from '../src/index';
const state = { v: 1, s: [], i: [] };
const hash = (n: number) => n.toString(16).padStart(64, '0');
const owner = (id: string, parent: string | null, outlet: string | null, n: number) => ({ id, parent, outlet, contract: hash(1), reuseKey: hash(n), propsDigest: hash(n), state, html: `<div data-forma-owner="${id}" data-forma-ssr data-forma-build="build"><p>${id}-${n}</p>${outlet ? '<div data-forma-outlet="child"></div>' : ''}</div>` });
let root: HTMLElement, session: AdapterSession, initial: Record<string, any>;
const scopes: AdapterSession[] = [];
const context = (path = '/b'): NavigationContext => ({ url: new URL(`http://localhost:3000${path}`), signal: new AbortController().signal, matches: [], revalidate: false, location: () => ({ url: new URL('http://localhost:3000/a'), key: 'a', matches: [] }) });
function serve(data: Record<string, any>, status = data.status ?? 200) { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/vnd.forma.navigation+json', 'cache-control': 'no-store', vary: 'Accept' } }))); }
beforeEach(async () => {
  const doc = document.implementation.createHTMLDocument('native'); vi.stubGlobal('document', doc);
  initial = { version: 1, app: 'app', build: 'build', group: 'group', layout: 'layout', context: 'context', policy: hash(9), policyProfile: 'page-response-only-v1', actions: ['/save'], assets: [{ kind: 'script', url: '/_assets/bootstrap.js', integrity: 'sha384-' + 'A'.repeat(64) }], title: 'Initial', owners: [owner('shell', null, 'child', 1), owner('a', 'shell', null, 2)] };
  root = doc.createElement('main'); root.innerHTML = initial.owners[0].html; root.querySelector('[data-forma-outlet]')!.innerHTML = initial.owners[1].html; doc.body.append(root);
  const metadata = doc.createElement('script'); metadata.setAttribute('data-forma-navigation', ''); metadata.textContent = JSON.stringify(initial); doc.head.append(metadata);
  const block = doc.createElement('script'); block.type = 'application/json'; block.setAttribute('data-island-state', ''); block.textContent = JSON.stringify(state); doc.head.append(block);
  session = createNativeAdapter({ app: 'app', build: 'build', group: 'group', owners: ['shell', 'a', 'b'], registrations: {} }).connect(root); scopes.push(session); await session.initialize!(context('/a'));
});
afterEach(() => { scopes.splice(0).forEach(s => s.dispose()); vi.unstubAllGlobals(); });
function destination(extra: Record<string, unknown> = {}) { return { ...initial, kind: 'page', status: 200, route: '/b', title: 'B', owners: [initial.owners[0], owner('b', 'shell', null, 3)], ...extra }; }
it('retains the exact layout, replaces its leaf, and tolerates a fully unchanged branch', async () => {
  const shell = root.firstElementChild, leaf = root.querySelector('[data-forma-owner="a"]'); serve(destination()); const page = await session.prepare(context()) as PreparedView;
  expect(root.querySelector('[data-forma-owner="a"]')).toBe(leaf); page.validate(); page.commit(); await page.activate(); expect(root.firstElementChild).toBe(shell); expect(leaf!.isConnected).toBe(false); expect(root.querySelector('[data-forma-owner="b"]')).not.toBeNull();
  const unchanged = await session.prepare(context()) as PreparedView; unchanged.commit(); await unchanged.activate(); expect(root.firstElementChild).toBe(shell);
});
it.each(['app', 'build', 'group', 'layout', 'context', 'policy', 'policyProfile'])('refuses incompatible %s before DOM replacement', async key => {
  const shell = root.firstElementChild; serve(destination({ [key]: 'different' })); await expect(session.prepare(context())).rejects.toThrow(`ROUTER_IDENTITY_${key.toUpperCase()}`); expect(root.firstElementChild).toBe(shell);
});
it('ignores claims injected into the response for a retained owner', async () => {
  const shell = root.firstElementChild; serve(destination({ owners: [{ ...initial.owners[0], html: '<script>bad()</script>', state: { attacker: true } }, owner('b', 'shell', null, 3)] }));
  const page = await session.prepare(context()) as PreparedView; page.commit(); await page.activate(); expect(root.firstElementChild).toBe(shell); expect(root.querySelector('script')).toBeNull();
});
it.each([404, 410, 500, 503])('admits typed error status %s without turning it into an empty success', async status => {
  serve(destination({ kind: 'error', status })); const page = await session.prepare(context()) as PreparedView; expect(page.status).toBe(status); page.commit(); await page.activate(); expect(root.textContent).toContain('b-3');
});
it('refuses transport/envelope status mismatch and revokes on authentication boundaries', async () => {
  serve(destination({ status: 404, kind: 'error' }), 200); await expect(session.prepare(context())).rejects.toThrow('ROUTER_RESPONSE_SCHEMA');
  serve({}, 401); await expect(session.prepare(context())).rejects.toMatchObject({ code: 'ROUTER_AUTH', revoke: true });
});
it('refuses duplicate/overlapping/moved owner branches and disposes uncommitted preparation', async () => {
  serve(destination({ owners: [initial.owners[0], { ...owner('b', 'shell', null, 3), parent: 'other' }] })); await expect(session.prepare(context())).rejects.toThrow('ROUTER_OWNER_ID');
  serve(destination()); const page = await session.prepare(context()) as PreparedView; root.firstElementChild!.remove(); expect(() => page.commit()).toThrow('ROUTER_OWNER_MOVED'); page.dispose();
});
it('binds managed outcomes to the declared endpoint and actual transport status', () => {
  const envelope = { ...initial, kind: 'action', endpoint: '/save', status: 422, outcome: 'validation', data: { message: 'Invalid' } };
  const response = new Response('', { status: 422 }); expect(session.admitAction!(envelope, response, new URL('http://localhost:3000/save')).outcome).toBe('validation');
  expect(() => session.admitAction!({ ...envelope, endpoint: '/other' }, response, new URL('http://localhost:3000/save'))).toThrow('ROUTER_ACTION_IDENTITY');
  expect(() => session.admitAction!({ ...envelope, outcome: 'redirect', status: 200, data: { status: 307, location: '/b' } }, new Response(), new URL('http://localhost:3000/save'))).toThrow('ROUTER_ACTION_REDIRECT');
});
it.each(['layout', 'context', 'policy', 'assets', 'owners'])('refuses a bootstrap missing %s rather than equating absent admission fields', key => {
  const script = document.querySelector('[data-forma-navigation]')!; const data = JSON.parse(script.textContent!); delete data[key]; script.textContent = JSON.stringify(data);
  expect(() => createNativeAdapter({ app: 'app', build: 'build', group: 'group', owners: ['shell', 'a', 'b'], registrations: {} }).connect(root)).toThrow();
});
it('rejects an action with a copied policy digest but a missing sealed profile or changed action set', () => {
  const envelope = { ...initial, kind: 'action', endpoint: '/save', status: 200, outcome: 'success', data: {} }; const url = new URL('http://localhost:3000/save');
  expect(() => session.admitAction!({ ...envelope, policyProfile: undefined }, new Response(), url)).toThrow('ROUTER_ACTION_IDENTITY');
  expect(() => session.admitAction!({ ...envelope, actions: ['/other'] }, new Response(), url)).toThrow('ROUTER_ACTION_IDENTITY');
});
it('counts retained layout hosts in the final 200-island bound', async () => {
  const shell = root.firstElementChild!;
  for (let i = 0; i < 201; i++) { const injected = document.createElement('span'); injected.setAttribute('data-forma-island', String(i)); shell.prepend(injected); }
  serve(destination()); await expect(session.prepare(context())).rejects.toThrow('ROUTER_ISLAND_LIMIT'); expect(root.querySelector('[data-forma-owner="a"]')).not.toBeNull();
});
it('bounds the initial aggregate before any original state can be adopted', async () => {
  const doc = document.implementation.createHTMLDocument('oversized'); const metadata = doc.createElement('script'); metadata.setAttribute('data-forma-navigation', ''); metadata.textContent = JSON.stringify(initial); doc.head.append(metadata);
  const container = doc.createElement('main'); container.innerHTML = initial.owners[0].html; container.querySelector('[data-forma-outlet]')!.innerHTML = initial.owners[1].html; doc.body.append(container);
  for (let i = 0; i < 201; i++) { const node = doc.createElement('span'); node.setAttribute('data-forma-island', String(i)); container.firstElementChild!.prepend(node); }
  const oversized = createNativeAdapter({ app: 'app', build: 'build', group: 'group', owners: ['shell', 'a'], registrations: {} }).connect(container); scopes.push(oversized); await expect(oversized.initialize!(context())).rejects.toThrow('ROUTER_ISLAND_LIMIT');
});
