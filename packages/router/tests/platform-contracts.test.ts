import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRouter, defineRoutes, matchRoutes,
  type ActionOutcome, type RouteAdapter, type Router,
} from '../src/index';

let root: HTMLElement;
const routers: Router[] = [];
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
// Exercise the document listener with a composed anchor path. Real native default
// actions are covered by the browser fixture; Happy DOM runs them too early when
// bubbling through an anchor and would start an unrelated emulated network load.
function clickPath(anchor: HTMLAnchorElement, options: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...options });
  vi.spyOn(event, 'composedPath').mockReturnValue([anchor.firstChild!, anchor, root, document, window]);
  document.dispatchEvent(event);
  return event;
}

function fixture(base = '/') {
  const commits: string[] = [];
  const adapter: RouteAdapter = {
    kind: 'browser',
    connect() {
      return {
        async prepare({ url }) {
          return {
            validate() {}, commit() { commits.push(url.href); },
            async activate() {}, dispose() {},
          };
        },
        allowsAction: url => url.pathname === '/save',
        admitAction: value => value as ActionOutcome,
        dispose() {},
      };
    },
  };
  const router = createRouter({ root, base, adapter, routes: [{ id: 'all', path: '*' }] });
  routers.push(router);
  return { router, commits };
}

beforeEach(() => {
  document.body.replaceChildren();
  history.replaceState({ application: 'preserved' }, '', '/app/team/alice');
  sessionStorage.clear();
  root = document.createElement('main');
  document.body.append(root);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  for (const router of routers.splice(0)) router.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compound route grammar', () => {
  const routes = defineRoutes([{
    id: 'shell',
    children: [{
      id: 'team', path: 'team/:team',
      children: [{
        id: 'section', children: [
          { id: 'index', index: true },
          { id: 'settings', path: 'settings' },
          { id: 'member', path: ':member' },
          { id: 'tail', path: '*' },
        ],
      }],
    }],
  }]);

  it.each([
    ['/team/blue', 'index', undefined],
    ['/team/blue/', 'index', undefined],
    ['/team/blue/settings', 'settings', undefined],
    ['/team/blue/alice', 'member', 'alice'],
    ['/team/blue/a%2Fb', 'member', 'a/b'],
    ['/team/blue/one/two', 'tail', undefined],
  ])('consumes %s through pathless owners and selects %s', (path, leaf, member) => {
    const matches = matchRoutes(routes, path)!;
    expect(matches.map(match => match.id)).toEqual(['shell', 'team', 'section', leaf]);
    expect(Object.keys(matches[0].params)).toEqual([]);
    expect(matches[1].params).toEqual({ team: 'blue' });
    expect(matches[2].params).toEqual({ team: 'blue' });
    expect(matches[3].params.member).toBe(member);
    if (leaf === 'tail') expect(matches[3].params['*']).toBe('one/two');
  });

  it('does not treat a parent as an implicit index or accept a partial leaf', () => {
    const strict = defineRoutes([{
      id: 'shell', path: 'team', children: [{ id: 'settings', path: 'settings' }],
    }]);
    expect(matchRoutes(strict, '/team')).toBeNull();
    expect(matchRoutes(strict, '/team/settings/extra')).toBeNull();
    expect(matchRoutes(strict, '/team//settings')).toBeNull();
  });

  it('rejects duplicate pathless indexes and duplicate parameter names across owners', () => {
    expect(() => defineRoutes([{ id: 'shell', children: [
      { id: 'one', index: true }, { id: 'wrap', children: [{ id: 'two', index: true }] },
    ] }])).toThrow('ROUTER_AMBIGUOUS');
    expect(() => defineRoutes([{ id: 'a', path: ':name', children: [
      { id: 'b', path: ':name' },
    ] }])).toThrow('ROUTER_PARAM');
  });

  it('preserves encoded literals and prototype-named parameters without pollution', () => {
    const encoded = defineRoutes([{ id: 'x', path: 'caf%C3%A9/:constructor/:__proto__' }]);
    const match = matchRoutes(encoded, '/caf%C3%A9/a%2Bb/%F0%9F%8C%8D')![0];
    expect(match.params.constructor).toBe('a+b');
    expect(match.params.__proto__).toBe('🌍');
    expect(Object.getPrototypeOf(match.params)).toBeNull();
  });
});

describe('non-root base and platform URL behavior', () => {
  it('resolves relatives from the committed URL and keeps repeated query and fragment encoding', async () => {
    const { router } = fixture('/app/');
    await router.ready;
    await router.navigate('bob?tag=a+b&tag=a%2Bb#caf%C3%A9');
    expect(router.location().url.pathname).toBe('/app/team/bob');
    expect(router.location().url.searchParams.getAll('tag')).toEqual(['a b', 'a+b']);
    expect(router.location().url.hash).toBe('#caf%C3%A9');
    expect(router.location().matches[0].params['*']).toBe('team/bob');
    await router.navigate('../settings', { replace: true });
    expect(router.location().url.pathname).toBe('/app/settings');
    expect(history.state.application).toBe('preserved');
    await router.navigate('/app');
    expect(router.location().matches[0].params['*']).toBe('');
  });

  it('refuses imperative destinations outside the base without changing either document or view', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const { router, commits } = fixture('/app/');
    await router.ready;
    expect(await router.navigate('/elsewhere')).toEqual({ kind: 'failed', code: 'ROUTER_URL' });
    expect(assign).not.toHaveBeenCalled();
    expect(commits).toEqual([]);
  });

  it.each([
    ['meta', { metaKey: true }, ''], ['control', { ctrlKey: true }, ''],
    ['shift', { shiftKey: true }, ''], ['alt', { altKey: true }, ''],
    ['middle', { button: 1 }, ''], ['target', {}, 'target="_blank"'],
    ['download', {}, 'download'], ['opt-out', {}, 'data-no-router'],
  ])('leaves %s anchor behavior to the browser', async (_name, eventOptions, attributes) => {
    const { router, commits } = fixture('/app/');
    await router.ready;
    root.innerHTML = `<a href="/app/next" ${attributes}><span>Next</span></a>`;
    let intercepted = true;
    const stopNativeNavigation = (event: Event) => {
      intercepted = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', stopNativeNavigation, { once: true });
    clickPath(root.querySelector('a')!, eventOptions);
    await flush();
    expect(intercepted).toBe(false);
    expect(commits).toEqual([]);
  });

  it('intercepts a normal nested anchor click and honours blockers before any commit', async () => {
    const { router, commits } = fixture('/app/');
    await router.ready;
    const unregister = router.beforeLeave(() => false);
    expect(await router.navigate('/app/blocked')).toEqual({ kind: 'blocked' });
    expect(commits).toEqual([]);
    unregister();
    root.innerHTML = '<a href="/app/next"><span>Next</span></a>';
    const event = clickPath(root.querySelector('a')!);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(router.location().url.pathname).toBe('/app/next');
    expect(commits).toHaveLength(1);
  });
});

describe('native form construction', () => {
  it('uses platform multipart boundaries and the declared endpoint outside the route base', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      outcome: 'validation', status: 422, data: { message: 'Keep entered values' },
    }), { status: 422, headers: {
      'Content-Type': 'application/vnd.forma.action+json',
      'Cache-Control': 'no-store', Vary: 'Accept',
    } }));
    vi.stubGlobal('fetch', fetcher);
    const { router } = fixture('/app/');
    await router.ready;
    root.innerHTML = '<form method="post" action="/wrong" enctype="text/plain">'
      + '<input name="tag" value="a"><input name="tag" value="b">'
      + '<input name="excluded" value="secret" disabled>'
      + '<input name="method" value="shadowed"><input name="action" value="shadowed">'
      + '<button type="submit" name="intent" value="save" formaction="/save" '
      + 'formenctype="multipart/form-data">Save</button></form>';
    const form = root.querySelector('form')!;
    const button = root.querySelector('button')!;
    expect((await router.submit(form, button)).kind).toBe('validation');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/save');
    expect(options.redirect).toBe('error');
    expect(new Headers(options.headers).has('Content-Type')).toBe(false);
    const body = options.body as FormData;
    expect(body.getAll('tag')).toEqual(['a', 'b']);
    expect(body.has('excluded')).toBe(false);
    expect(body.get('intent')).toBe('save');
    expect(body.get('method')).toBe('shadowed');
    expect(form.querySelector<HTMLInputElement>('[name=tag]')!.value).toBe('a');
  });
});
