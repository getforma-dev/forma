import { describe, expect, it, vi } from 'vitest';
import { __adoptionChild, describingAdoption, withAdoptionDescription, type ComponentDescription } from '../adoption-description.js';
import { h, fragment, Fragment } from '../element.js';
import { createShow } from '../show.js';
import { createList } from '../list.js';
import { __islandRegistration, preflightIslands, matchAdoptionChild, type IslandSchema } from '../island-state.js';
import { installState, FIXTURE_HASH } from './helpers/compiled-island.js';

function child<P extends object>(component: (props: P) => unknown, schema: IslandSchema, props: object) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<section data-forma-island data-forma-component="Child"><button>server</button></section>';
  const host = doc.querySelector('section')!;
  installState([props], doc);
  const result = preflightIslands({ Child: __islandRegistration(component, { h: FIXTURE_HASH, schema, mode: 0 }) }, doc)[0]!;
  if (!('value' in result)) throw result.error;
  return { doc, host, value: result.value };
}
function describeChild<A extends unknown[], R>(component: (...args: A) => R, args: A): ComponentDescription {
  return withAdoptionDescription(() => __adoptionChild(undefined, component, args)) as ComponentDescription;
}

describe('private lazy component description', () => {
  it('restores scoped description after nesting and a throw', () => {
    expect(describingAdoption).toBe(false);
    expect(() => withAdoptionDescription(() => {
      expect(describingAdoption).toBe(true);
      withAdoptionDescription(() => { expect(describingAdoption).toBe(true); });
      expect(describingAdoption).toBe(true); throw new Error('partial component');
    })).toThrow('partial component');
    expect(describingAdoption).toBe(false);
  });

  it('describes h, fragments, Show and For without creating DOM or executing callbacks', () => {
    const callback = vi.fn(), create = vi.spyOn(document, 'createElement');
    const createFragment = vi.spyOn(document, 'createDocumentFragment');
    try {
      const output = withAdoptionDescription(() => h('div', { ref: callback, onClick: callback },
        h(callback, null), h(Fragment, null, 'text'), fragment('other'),
        createShow(callback, callback, callback), createList(callback, callback, callback),
      )) as unknown as { type: string; children: { type: string }[] };
      expect(output.type).toBe('element');
      expect(output.children.map(item => item.type)).toEqual(['component', 'fragment', 'fragment', 'show', 'list']);
      expect(callback).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(createFragment).not.toHaveBeenCalled();
    } finally { create.mockRestore(); createFragment.mockRestore(); }
    h(callback, { count: 7 });
    expect(callback).toHaveBeenCalledExactlyOnceWith({ count: 7, children: [] });
  });

  it('preserves callee and argument evaluation once and keeps ordinary zero versus one argument calls', () => {
    const calls: { receiver: unknown; args: unknown[] }[] = [];
    function component(this: unknown, ...args: unknown[]) { calls.push({ receiver: this, args }); return args.length; }
    const callee = vi.fn(() => component), argument = vi.fn(() => ({ count: 7 }));
    const description = withAdoptionDescription(() => __adoptionChild(undefined, callee(), [argument()])) as unknown as ComponentDescription;
    expect(callee).toHaveBeenCalledOnce(); expect(argument).toHaveBeenCalledOnce(); expect(calls).toEqual([]);
    expect(description.component).toBe(component); expect(description.args[0]).toBe(argument.mock.results[0]!.value);
    expect(__adoptionChild(undefined, component, [])).toBe(0);
    expect(__adoptionChild(undefined, component, [undefined])).toBe(1);
    expect(calls).toEqual([{ receiver: undefined, args: [] }, { receiver: undefined, args: [undefined] }]);
  });

  it('does not silently merge h props with direct-call props or execute the nested component', () => {
    const component = vi.fn(), props = { count: 7 }, children = ['child'];
    const direct = describeChild(component, [props]);
    const hyperscript = withAdoptionDescription(() => h(component, props, ...children)) as unknown as ComponentDescription;
    expect(direct.args).toEqual([props]); expect(direct.args[0]).toBe(props);
    expect(hyperscript.args).toEqual([{ count: 7, children }]); expect(component).not.toHaveBeenCalled();
  });
});

describe('per-host original child authority and declared-value parity', () => {
  it('matches the original component and own child props without executing it or changing its shell', () => {
    const component = vi.fn(), fixture = child(component, [[{ name: 'count', type: { kind: 'number' } }]], { count: 7 });
    const before = fixture.host.outerHTML, observer = new MutationObserver(() => {});
    observer.observe(fixture.host, { subtree: true, attributes: true, childList: true, characterData: true });
    matchAdoptionChild(fixture.host, describeChild(component, [{ count: 7, children: ['ignored'], extra: 9 }]), fixture.value);
    expect(component).not.toHaveBeenCalled(); expect(fixture.host.outerHTML).toBe(before);
    expect(observer.takeRecords()).toEqual([]); observer.disconnect();
    expect(() => matchAdoptionChild(fixture.host, describeChild(component, [{ count: 8 }]), fixture.value)).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(() => matchAdoptionChild(fixture.host, describeChild(vi.fn(), [{ count: 7 }]), fixture.value)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  });

  it('does not replace per-host registration with the last registration of the same function', () => {
    const component = vi.fn(), schema: IslandSchema = [[{ name: 'count', type: { kind: 'number' } }]];
    const first = child(component, schema, { count: 1 }), second = child(component, schema, { count: 2 });
    matchAdoptionChild(first.host, describeChild(component, [{ count: 1 }]), first.value);
    matchAdoptionChild(second.host, describeChild(component, [{ count: 2 }]), second.value);
    expect(() => matchAdoptionChild(first.host, describeChild(component, [{ count: 1 }]), second.value)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
    expect(component).not.toHaveBeenCalled();
  });

  it('keeps zero-argument children with optional or empty schemas and refuses missing required inputs', () => {
    const component = vi.fn(), optional = child(component, [[{ name: 'note', type: { kind: 'optional', inner: { kind: 'string' } } }]], {});
    matchAdoptionChild(optional.host, describeChild(component, []), optional.value);
    matchAdoptionChild(optional.host, describeChild(component, [{ note: null }]), optional.value);
    const empty = child(component, [[]], {});
    matchAdoptionChild(empty.host, describeChild(component, []), empty.value);
    const required = child(component, [[{ name: 'count', type: { kind: 'number' } }]], { count: 7 });
    expect(() => matchAdoptionChild(required.host, describeChild(component, []), required.value)).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(() => matchAdoptionChild(empty.host, describeChild(component, [{}, {}]), empty.value)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  });

  it('compares nested fields, array positions, enums and intrinsic Date values by schema', () => {
    const component = vi.fn(), schema: IslandSchema = [[
      { name: 'record', type: { kind: 'object', object: 1 } },
    ], [
      { name: 'at', type: { kind: 'date' } },
      { name: 'mode', type: { kind: 'enum', variants: ['a', 'b'] } },
      { name: 'values', type: { kind: 'array', element: { kind: 'optional', inner: { kind: 'number' } } } },
    ]];
    const fixture = child(component, schema, { record: { at: -12, mode: 'a', values: [0, null, 7] } });
    const getter = vi.fn(() => 999), at = new Date(-12); at.getTime = getter;
    const record = { at, mode: 'a', values: [-0, undefined, 7] };
    matchAdoptionChild(fixture.host, describeChild(component, [{ record }]), fixture.value);
    expect(getter).not.toHaveBeenCalled();
    expect(() => matchAdoptionChild(fixture.host, describeChild(component, [{ record: { ...record, at: new Date(-13) } }]), fixture.value)).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(() => matchAdoptionChild(fixture.host, describeChild(component, [{ record: { ...record, mode: 'b' } }]), fixture.value)).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(() => matchAdoptionChild(fixture.host, describeChild(component, [{ record: { ...record, values: [0, , 7] } }]), fixture.value)).toThrow('FORMA_E_HYDRATE_VALUE');
  });

  it('never invokes declared accessors or traverses an undeclared extra getter', () => {
    const component = vi.fn(), getter = vi.fn(() => 7), extra = vi.fn(() => { throw new Error('extra'); });
    const fixture = child(component, [[{ name: 'count', type: { kind: 'number' } }]], { count: 7 });
    const accepted = { count: 7 }; Object.defineProperty(accepted, 'extra', { get: extra });
    matchAdoptionChild(fixture.host, describeChild(component, [accepted]), fixture.value);
    expect(extra).not.toHaveBeenCalled();
    const refused = {}; Object.defineProperty(refused, 'count', { get: getter });
    expect(() => matchAdoptionChild(fixture.host, describeChild(component, [refused]), fixture.value)).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(getter).not.toHaveBeenCalled();
  });

  it('retains original child state even after handed-out props and Date internals change', () => {
    const component = vi.fn(), schema: IslandSchema = [[
      { name: 'at', type: { kind: 'date' } },
      { name: 'values', type: { kind: 'array', element: { kind: 'number' } } },
    ]];
    const fixture = child(component, schema, { at: 12, values: [7] });
    (fixture.value.props.at as Date).setTime(999);
    (fixture.value.props.values as number[])[0] = 42;
    matchAdoptionChild(fixture.host, describeChild(component, [{ at: new Date(12), values: [7] }]), fixture.value);
    expect(() => matchAdoptionChild(fixture.host, describeChild(component, [fixture.value.props]), fixture.value)).toThrow('FORMA_E_HYDRATE_VALUE');
    const later = preflightIslands({ Child: __islandRegistration(component, { h: FIXTURE_HASH, schema, mode: 0 }) }, fixture.doc)[0]!;
    if (!('value' in later)) throw later.error;
    expect(later.value.props).toEqual({ at: new Date(12), values: [7] });
  });

  it('never invokes array accessors or accepts a copied authority or detached original host', () => {
    const component = vi.fn(), getter = vi.fn(() => 'value');
    const fixture = child(component, [[{ name: 'values', type: { kind: 'array', element: { kind: 'string' } } }]], { values: ['value'] });
    const values = ['value']; Object.defineProperty(values, 0, { get: getter });
    expect(() => matchAdoptionChild(fixture.host, describeChild(component, [{ values }]), fixture.value)).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(getter).not.toHaveBeenCalled();
    const description = describeChild(component, [{ values: ['value'] }]);
    expect(() => matchAdoptionChild(fixture.host, description, { ...fixture.value })).toThrow('FORMA_E_ISLAND_IDENTITY');
    fixture.host.remove();
    expect(() => matchAdoptionChild(fixture.host, description, fixture.value)).toThrow('FORMA_E_ISLAND_IDENTITY');
  });
});
