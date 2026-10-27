import { NavigationError, type Match, type RouteDefinition } from './types';
type Segment = { kind: 'literal' | 'param' | 'splat'; value: string };
type Branch = { chain: RouteDefinition[]; segments: Segment[]; score: number[] };
const compiled = new WeakMap<readonly RouteDefinition[], readonly Branch[]>();
function fail(code: string): never { throw new NavigationError(code); }
function segments(path: string): Segment[] {
  if (path === '' || path === '/') return [];
  if (path.startsWith('/') || path.endsWith('/') || path.includes('//')) fail('ROUTER_ROUTE_PATH');
  const names = new Set<string>();
  return path.split('/').map((s, i, parts) => {
    if (s === '*') { if (i !== parts.length - 1) fail('ROUTER_SPLAT_TERMINAL'); return { kind: 'splat', value: '*' }; }
    if (s.startsWith(':')) {
      const name = s.slice(1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || names.has(name)) fail('ROUTER_PARAM');
      names.add(name); return { kind: 'param', value: name };
    }
    if (/[:*?;()[\]#\\]/.test(s) || s === '.' || s === '..') fail('ROUTER_ROUTE_GRAMMAR');
    let value: string; try { value = decodeURIComponent(s); } catch { return fail('ROUTER_ENCODING'); }
    return { kind: 'literal', value };
  });
}
// Scores are a one-to-one encoding of segment kinds. Equal rank therefore
// requires equal lengths/kinds; with terminal splats, overlap then depends
// only on literal equality. Empty branches overlap as well.
function overlapsAtEqualRank(a: Segment[], b: Segment[]) {
  return a.length === b.length && a.every((token, i) => token.kind === b[i].kind
    && (token.kind !== 'literal' || token.value === b[i].value));
}
/** Copy and validate caller configuration; mutation of the source never changes matching. */
export function defineRoutes(input: readonly RouteDefinition[]): readonly RouteDefinition[] {
  if (!Array.isArray(input)) return fail('ROUTER_ROUTES');
  const ids = new Set<string>(), branches: Branch[] = []; let count = 0;
  function visit(list: readonly RouteDefinition[], parent: RouteDefinition[], tokens: Segment[], depth: number): readonly RouteDefinition[] {
    if (depth > 32) return fail('ROUTER_ROUTE_DEPTH');
    return Object.freeze(list.map(source => {
      if (++count > 1000) fail('ROUTER_ROUTE_LIMIT');
      if (!source || typeof source.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(source.id) || ids.has(source.id)) fail('ROUTER_ROUTE_ID');
      ids.add(source.id);
      if (source.index && (source.path !== undefined || source.children?.length)) fail('ROUTER_INDEX');
      const own = segments(source.path ?? '');
      if (tokens.some(t => t.kind === 'splat') && own.length) fail('ROUTER_SPLAT_TERMINAL');
      const all = [...tokens, ...own];
      const paramNames = all.filter(t => t.kind === 'param').map(t => t.value);
      if (new Set(paramNames).size !== paramNames.length) fail('ROUTER_PARAM');
      const route: RouteDefinition = { id: source.id, ...(source.path === undefined ? {} : { path: source.path }), ...(source.index ? { index: true } : {}), adapter: source.adapter, render: source.render, reuseKey: source.reuseKey };
      const chain = [...parent, route];
      if (source.children) Object.assign(route, { children: visit(source.children, chain, all, depth + 1) });
      // A parent with children supplies ownership, not an implicit ambiguous index leaf.
      if (!source.children?.length || source.index) branches.push({ chain, segments: all, score: all.map(t => t.kind === 'literal' ? 3 : t.kind === 'param' ? 2 : 1) });
      return Object.freeze(route);
    }));
  }
  const routes = visit(input, [], [], 1);
  for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++) {
    if (overlapsAtEqualRank(branches[i].segments, branches[j].segments)) fail('ROUTER_AMBIGUOUS');
  }
  branches.sort((a, b) => {
    for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
      const x = a.score[i] ?? 4, y = b.score[i] ?? 4; // exact end outranks an empty splat
      if (x !== y) return y - x;
    }
    return 0;
  });
  compiled.set(routes, branches); return routes;
}
export function matchRoutes(routes: readonly RouteDefinition[], pathname: string): readonly Match[] | null {
  const branches = compiled.get(routes);
  if (!branches) return matchRoutes(defineRoutes(routes), pathname);
  if (!pathname.startsWith('/') || pathname.includes('//')) return null;
  let parts: string[];
  try { parts = pathname.slice(1).split('/').filter(Boolean).map(decodeURIComponent); } catch { return fail('ROUTER_ENCODING'); }
  for (const branch of branches) {
    const params: Record<string, string> = Object.create(null); let pos = 0, ok = true;
    for (const token of branch.segments) {
      if (token.kind === 'splat') { params['*'] = parts.slice(pos).join('/'); pos = parts.length; break; }
      const part = parts[pos++];
      if (part === undefined || (token.kind === 'literal' && token.value !== part)) { ok = false; break; }
      if (token.kind === 'param') params[token.value] = part;
    }
    if (ok && pos === parts.length) {
      const inherited: Record<string, string> = Object.create(null);
      return Object.freeze(branch.chain.map(definition => {
        for (const token of segments(definition.path ?? '')) if (token.kind !== 'literal') inherited[token.value] = params[token.value];
        return Object.freeze({ id: definition.id, params: Object.freeze(Object.assign(Object.create(null), inherited)), definition });
      }));
    }
  }
  return null;
}
