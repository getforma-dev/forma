import { h } from '../element.js';
/** Original error-isolation and deep-projection controls, with authoritative head state. */
import { compiled, emptyRegistry, FIXTURE_HASH, installState, useFreshDocument } from './helpers/compiled-island.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEffect, createSignal } from 'forma/reactive';
import { activateIslands, deactivateIsland, sanitizePropsDeep } from '../activate';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('removed shared props block', () => {
  it.each(['malformed', 'empty', 'non-script', 'valid'] as const)('refuses the %s legacy block without using it as fallback', legacy => {
    const body = legacy === 'malformed' ? '{"0":{"broken":' : legacy === 'empty' ? '' : '{"0":{"role":"admin"}}';
    const tag = legacy === 'non-script' ? 'div' : 'script';
    document.body.innerHTML = `<div data-forma-island="0" data-forma-component="A" data-forma-status="pending"><p>0</p></div><${tag} id="__forma_islands" type="application/json">${body}</${tag}>`;
    const component = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = document.documentElement.outerHTML;
    activateIslands(emptyRegistry({ A: component }));
    expect(component).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).toBe(before);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_STATE'));
  });

  it('ignores a body block when the first head block supplies valid declared props', async () => {
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="A" data-forma-status="pending"><p>0</p></div><script id="__forma_islands" type="application/json">{"0":{"title":"attacker"}}</script>';
    installState([{ title: 'hello' }]);
    const component = vi.fn((_props: Record<string, unknown>) => h('div', null, h('p', null, '0')));
    await activateIslands({ A: compiled(component, [[{ name: 'title', type: { kind: 'string' } }]]) });
    expect(component).toHaveBeenCalledExactlyOnceWith({ title: 'hello' });
    expect(document.querySelector('[data-forma-island]')!.getAttribute('data-forma-status')).toBe('pending');
  });
});

describe('failed island teardown', () => {
  it('disposes effects created before a failing island threw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Boom" data-forma-status="pending"><p>x</p></div>
    `;
    installState();

    const [count, setCount] = createSignal(0);
    let runs = 0;

    await activateIslands(emptyRegistry({
      Boom: () => {
        createEffect(() => { count(); runs++; });
        throw new Error('kaboom');
      },
    }));

    const island = document.querySelector('[data-forma-island]')!;
    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(runs).toBe(0);

    // A zombie island keeps re-running its bindings on every shared-signal write.
    setCount(1);
    expect(runs).toBe(0);
    // Nothing is left dangling for deactivateIsland to find.
    expect((island as unknown as { __formaDispose?: unknown }).__formaDispose).toBeUndefined();
    expect(() => deactivateIsland(island as HTMLElement)).not.toThrow();
  });

  it('keeps a successful island reactive and disposable', async () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Ok" data-forma-status="pending"><p>x</p></div>
    `;
    installState();

    const [count, setCount] = createSignal(0);
    let runs = 0;

    await activateIslands(emptyRegistry({ Ok: () => { createEffect(() => { count(); runs++; }); return h('div', null, h('p', null, 'x')); } }));

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(island.getAttribute('data-forma-status')).toBe('pending');
    setCount(1);
    expect(runs).toBe(2);

    deactivateIsland(island);
    setCount(2);
    expect(runs).toBe(2);
    expect(island.getAttribute('data-forma-status')).toBe('disposed');
  });
});

describe('activateIslands root parameter', () => {
  it('refuses a shadow-only host even when the shadow root is explicitly passed', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<div data-forma-island="0" data-forma-component="Shadowed" data-forma-state="0" data-forma-h="${FIXTURE_HASH}" data-forma-status="pending"><p>in shadow</p></div>`;
    installState();
    const component = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = shadow.innerHTML;
    activateIslands(emptyRegistry({ Shadowed: component }));
    activateIslands(emptyRegistry({ Shadowed: component }), shadow);
    expect(component).not.toHaveBeenCalled(); expect(shadow.innerHTML).toBe(before);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_IDENTITY'));
  });

  it('an explicit light-DOM subtree shares original document authority', async () => {
    document.body.innerHTML = '<main><div data-forma-island="7" data-forma-component="A" data-forma-status="pending"><p>original</p></div></main>';
    installState([{ from: 'page' }]);
    const component = vi.fn((_props: Record<string, unknown>) => h('div', null, h('p', null, 'original')));
    await activateIslands({ A: compiled(component, [[{ name: 'from', type: { kind: 'string' } }]]) }, document.querySelector('main')!);
    expect(component).toHaveBeenCalledExactlyOnceWith({ from: 'page' });
    expect(document.querySelector('[data-forma-island]')!.getAttribute('data-forma-status')).toBe('pending');
  });
});

describe('sanitizePropsDeep', () => {
  it('sanitizePropsDeep strips forbidden keys at every depth', () => {
    const props = JSON.parse(
      '{"a":{"b":{"__proto__":{"isAdmin":true},"keep":1}},"list":[{"constructor":{"x":1},"prototype":{"x":2},"ok":2}]}',
    );

    const out = sanitizePropsDeep(props);

    expect(out).toBe(props);
    const nested = out.a.b as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(nested, '__proto__')).toBe(false);
    expect(nested['keep']).toBe(1);
    const row = out.list[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(row, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'prototype')).toBe(false);
    expect(row['ok']).toBe(2);
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
  });

  for (const lock of ['freeze', 'seal'] as const) {
    it.each(['__proto__', 'constructor', 'prototype'])(
      `refuses nested %s when Object.${lock} prevents deletion`,
      key => {
        const child = Object[lock](JSON.parse(`{"${key}":{"polluted":true},"keep":1}`));
        const props = { nested: [child] };
        const target = {};

        expect(() => Object.assign(target, sanitizePropsDeep(props).nested[0])).toThrow(TypeError);
        expect(Object.prototype.hasOwnProperty.call(child, key)).toBe(true);
        expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
        expect(Object.keys(target)).toEqual([]);
      },
    );
  }

  it('accepts harmless frozen data and cycles without replacing the input', () => {
    const nested = Object.freeze({ values: Object.freeze([Object.freeze({ keep: 1 })]) });
    const props: { nested: typeof nested; self?: unknown } = { nested };
    props.self = props;
    Object.freeze(props);

    expect(sanitizePropsDeep(props)).toBe(props);
    expect(props.nested).toBe(nested);
    expect(props.nested.values[0].keep).toBe(1);
    expect(props.self).toBe(props);
  });

  it('retains earlier in-place deletions when a later nested key is refused', () => {
    const props = JSON.parse('{"__proto__":{"polluted":true},"nested":{"prototype":{},"keep":1}}');
    Object.freeze(props.nested);

    expect(() => sanitizePropsDeep(props)).toThrow(TypeError);
    expect(Object.prototype.hasOwnProperty.call(props, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(props.nested, 'prototype')).toBe(true);
    expect(props.nested.keep).toBe(1);
  });

  it('sanitizePropsDeep terminates on cyclic props', () => {
    const a: Record<string, unknown> = JSON.parse('{"__proto__":{"isAdmin":true},"name":"a"}');
    a['self'] = a;

    expect(() => sanitizePropsDeep(a)).not.toThrow();
    expect(Object.prototype.hasOwnProperty.call(a, '__proto__')).toBe(false);
    expect(a['name']).toBe('a');
  });

  /** Every own key at every depth of a parsed value, walked without recursion. */
  function ownKeysAtEveryDepth(root: unknown): string[] {
    const keys: string[] = [];
    const todo: unknown[] = [root];
    while (todo.length > 0) {
      const v = todo.pop();
      if (v === null || typeof v !== 'object') continue;
      for (const k of Object.getOwnPropertyNames(v)) {
        keys.push(k);
        todo.push(Object.getOwnPropertyDescriptor(v, k)!.value);
      }
    }
    return keys;
  }

  it('island activation projects only declared safe fields at every depth for both instances', async () => {
    // The same hostile payload in two head-state entries. Every
    // pollution key sits below the top level, inside an object and inside an
    // array element, next to a benign sibling that must survive.
    const payload =
      '{"title":"t","nested":{"__proto__":{"isAdmin":true},"keep":3,' +
      '"deeper":{"constructor":{"prototype":{"x":1}},"prototype":{"y":2},"ok":4}},' +
      '"rows":[{"__proto__":{"row":true},"id":1},{"id":2}]}';
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="First" data-forma-status="pending"><p>0</p></div><div data-forma-island="1" data-forma-component="Second" data-forma-status="pending"><p>1</p></div>
    `;

    installState([JSON.parse(payload), JSON.parse(payload)]);
    const schema = [
      [{ name: 'title', type: { kind: 'string' } }, { name: 'nested', type: { kind: 'object', object: 1 } }, { name: 'rows', type: { kind: 'array', element: { kind: 'object', object: 3 } } }],
      [{ name: 'keep', type: { kind: 'number' } }, { name: 'deeper', type: { kind: 'object', object: 2 } }],
      [{ name: 'ok', type: { kind: 'number' } }],
      [{ name: 'id', type: { kind: 'number' } }],
    ] as const;
    const received: Record<string, unknown>[] = [];
    const merged: Record<string, unknown>[] = [];
    // A naive deep merge, the pattern DR-21 guards: a nested "__proto__" key
    // left in the props would walk it into Object.prototype.
    const deepMerge = (into: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> => {
      for (const k of Object.keys(from)) {
        const v = from[k];
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          into[k] = deepMerge((into[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
        } else {
          into[k] = v;
        }
      }
      return into;
    };
    const island = (props: Record<string, unknown>) => {
      received.push(props!);
      merged.push(deepMerge({}, props!));
      return h('div', null, h('p', null, String(received.length - 1)));
    };
    try {
      await activateIslands({ First: compiled(island, schema), Second: compiled(island, schema) });
      expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
      expect(({} as Record<string, unknown>)['row']).toBeUndefined();
    } finally {
      // Should the strip regress, do not leave the pollution for later tests.
      delete (Object.prototype as Record<string, unknown>)['isAdmin'];
      delete (Object.prototype as Record<string, unknown>)['row'];
    }

    expect(received).toHaveLength(2);
    for (const props of received) {
      const keys = ownKeysAtEveryDepth(props);
      expect(keys).not.toContain('__proto__');
      expect(keys).not.toContain('constructor');
      expect(keys).not.toContain('prototype');
      // Two-sided: everything benign is still there, at every depth.
      expect(props).toEqual({
        title: 't',
        nested: { keep: 3, deeper: { ok: 4 } },
        rows: [{ id: 1 }, { id: 2 }],
      });
    }
    expect(merged[0]).toEqual(merged[1]);
    // There is no opt-out: the islands never saw the keys, so a caller that
    // never heard of sanitizePropsDeep is covered too.
    expect(document.querySelectorAll('[data-forma-status="pending"]')).toHaveLength(2);
  });

  it('standalone sanitization still strips props nested 10,000 deep', () => {
    const DEPTH = 10_000;
    const text = '{"a":'.repeat(DEPTH) + '{"__proto__":{"deep":true},"leaf":1}' + '}'.repeat(DEPTH);
    const props = sanitizePropsDeep(JSON.parse(text));
    let bottom = props;
    for (let i = 0; i < DEPTH; i++) bottom = bottom.a;
    expect(Object.getOwnPropertyNames(bottom)).toEqual(['leaf']);
    expect(bottom.leaf).toBe(1);
    expect(({} as Record<string, unknown>).deep).toBeUndefined();
  });
});

useFreshDocument();
