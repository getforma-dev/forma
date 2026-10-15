import { describe, expect, it, vi } from 'vitest';
import {
  __islandRegistration, checkIslandClaim, preflightIslands,
  type IslandSchema, type IslandSchemaType, type IslandPreflight,
} from '../island-state.js';

const H = '0123456789abcdef';
const OTHER = 'fedcba9876543210';
const empty: IslandSchema = [[]];
const schema = (type: IslandSchemaType): IslandSchema => [[{ name: 'value', type }]];
const host = (index: number | string, name = 'Test', hash = H) =>
  `<div data-forma-island="0" data-forma-state="${index}" data-forma-component="${name}" data-forma-h="${hash}" data-forma-status="pending"><span>server</span></div>`;
const envelope = (props: unknown[] = [{}]) => ({ v: 1, s: [], i: props.map(p => ({ h: H, p })) });
function page(value: unknown = envelope(), body = host(0), text?: string): Document {
  const doc = document.implementation.createHTMLDocument('state');
  const script = doc.createElement('script');
  script.type = 'application/json'; script.setAttribute('data-island-state', '');
  script.textContent = text ?? JSON.stringify(value);
  doc.head.appendChild(script); doc.body.innerHTML = body;
  return doc;
}
function registration(shape = empty, component = vi.fn(), mode: 0 | 1 = 0) {
  return __islandRegistration(component, { h: H, schema: shape, mode });
}
function valid(result: IslandPreflight) {
  expect('value' in result, 'error' in result ? result.error.message : '').toBe(true);
  if ('error' in result) throw result.error;
  return result.value;
}
function code(result: IslandPreflight) {
  expect('error' in result).toBe(true);
  return 'error' in result ? result.error.code : undefined;
}

// These are ordinary fixed values, not generated fuzz inputs. Every schema has
// exactly 100 deterministic entries, including the required numeric/text edges.
const strings = ['</script>', '\0', '😀', 'é', '', '\\"\n', ...Array.from({ length: 94 }, (_, i) => `text-${i}`)];
const numbers = [2 ** 53 - 1, 2 ** 53, -Number.MAX_VALUE, Number.MIN_VALUE, 0, -0, ...Array.from({ length: 94 }, (_, i) => i / 10)];
const dates = [-8.64e15, 8.64e15, 0, ...Array.from({ length: 97 }, (_, i) => i - 49)];
const cases: { name: string; shape: IslandSchema; values: unknown[]; expected?: (value: any) => unknown }[] = [
  { name: 'string', shape: schema({ kind: 'string' }), values: strings },
  { name: 'number', shape: schema({ kind: 'number' }), values: numbers, expected: x => Object.is(x, -0) ? 0 : x },
  { name: 'boolean', shape: schema({ kind: 'boolean' }), values: Array.from({ length: 100 }, (_, i) => i % 2 === 0) },
  { name: 'date', shape: schema({ kind: 'date' }), values: dates, expected: x => new Date(x) },
  { name: 'enum', shape: schema({ kind: 'enum', variants: ['', 'x', '😀'] }), values: Array.from({ length: 100 }, (_, i) => ['', 'x', '😀'][i % 3]) },
  { name: 'array', shape: schema({ kind: 'array', element: { kind: 'optional', inner: { kind: 'string' } } }), values: strings.map(x => [x, null, x]) },
  { name: 'optional', shape: schema({ kind: 'optional', inner: { kind: 'number' } }), values: numbers.map((x, i) => i % 2 ? x : null), expected: x => x === null ? undefined : Object.is(x, -0) ? 0 : x },
  { name: 'nested object', shape: [[{ name: 'value', type: { kind: 'object', object: 1 } }], [{ name: 'name', type: { kind: 'string' } }]], values: strings.map(name => ({ name, secret: 'UNDECLARED' })), expected: x => ({ name: x.name }) },
];

for (const test of cases) it(`roundtrips 100 fixed ${test.name} values by the compiled schema`, () => {
  expect(test.values).toHaveLength(100);
  const doc = page(envelope(test.values.map(value => ({ value, secret: 'UNDECLARED' }))), test.values.map((_, i) => host(i)).join(''));
  const results = preflightIslands({ Test: registration(test.shape) }, doc);
  expect(results).toHaveLength(100);
  results.forEach((result, i) => {
    const props = valid(result).props;
    expect(props.value).toEqual(test.expected ? test.expected(test.values[i]) : test.values[i]);
    expect(Object.keys(props)).not.toContain('secret');
    expect(JSON.stringify(props)).not.toContain('UNDECLARED');
  });
});

describe('first-head document authority', () => {
  it.each([
    null, [], {}, { v: 1, s: [], i: [], extra: true }, { v: 2, s: [], i: [] },
    { v: 1, s: {}, i: [] }, { v: 1, s: [1], i: [] }, { v: 1, s: [], i: {} },
  ])('caches a malformed global envelope: %j', value => {
    const doc = page(value), registry = { Test: registration() };
    expect(code(preflightIslands(registry, doc)[0]!)).toBe('FORMA_E_ISLAND_STATE');
    doc.head.querySelector('script')!.textContent = JSON.stringify(envelope());
    expect(code(preflightIslands(registry, doc)[0]!)).toBe('FORMA_E_ISLAND_STATE');
  });
  it('does not use body, inline props, old spill, or a later replacement for a missing head block', () => {
    const doc = page(); doc.head.querySelector('script')!.remove();
    doc.body.insertAdjacentHTML('beforeend', '<script type="application/json" data-island-state>' + JSON.stringify(envelope()) + '</script><script id="__forma_islands">{"0":{}}</script>');
    doc.querySelector('[data-forma-island]')!.setAttribute('data-forma-props', '{}');
    const registry = { Test: registration() };
    expect(code(preflightIslands(registry, doc)[0]!)).toBe('FORMA_E_ISLAND_STATE');
    const replacement = doc.createElement('script'); replacement.type = 'application/json'; replacement.setAttribute('data-island-state', ''); replacement.textContent = JSON.stringify(envelope()); doc.head.appendChild(replacement);
    expect(code(preflightIslands(registry, doc)[0]!)).toBe('FORMA_E_ISLAND_STATE');
  });
  it('uses only the first matching head block and caches success despite edits', () => {
    const doc = page(envelope([{ value: 1001 }]));
    const later = doc.createElement('script'); later.type = 'application/json'; later.setAttribute('data-island-state', ''); later.textContent = JSON.stringify(envelope([{ value: 42 }])); doc.head.appendChild(later);
    const registry = { Test: registration(schema({ kind: 'number' })) };
    expect(valid(preflightIslands(registry, doc)[0]!).props.value).toBe(1001);
    doc.head.querySelector('script')!.textContent = '{';
    expect(valid(preflightIslands(registry, doc)[0]!).props.value).toBe(1001);
  });
  it('refuses invalid JSON once even if a later valid head block exists', () => {
    const doc = page(undefined, host(0), '{');
    const other = doc.createElement('script'); other.type = 'application/json'; other.setAttribute('data-island-state', ''); other.textContent = JSON.stringify(envelope()); doc.head.appendChild(other);
    expect(code(preflightIslands({ Test: registration() }, doc)[0]!)).toBe('FORMA_E_ISLAND_STATE');
  });
  it('accepts exactly one MiB encoded UTF8 and refuses the next byte before parsing', () => {
    const prefix = JSON.stringify(envelope([{ value: '' }]));
    for (const padding of ['x', '😀']) {
      const room = 1048576 - new TextEncoder().encode(prefix).length;
      const count = Math.floor(room / new TextEncoder().encode(padding).length);
      const value = padding.repeat(count) + 'x'.repeat(room - count * new TextEncoder().encode(padding).length);
      const text = JSON.stringify(envelope([{ value }]));
      expect(new TextEncoder().encode(text).length).toBe(1048576);
      valid(preflightIslands({ Test: registration(schema({ kind: 'string' })) }, page(undefined, host(0), text))[0]!);
      expect(code(preflightIslands({ Test: registration(schema({ kind: 'string' })) }, page(undefined, host(0), text + ' '))[0]!)).toBe('FORMA_E_ISLAND_STATE');
    }
  });
});

describe('entry and original-host isolation', () => {
  it.each([null, [], {}, { h: H, p: {}, extra: 1 }, { h: H.toUpperCase(), p: {} }, { h: H, p: null }, { h: H, p: [] }])('isolates malformed entry %j from a valid sibling', bad => {
    const doc = page({ v: 1, s: [], i: [bad, { h: H, p: {} }] }, host(0) + host(1));
    const results = preflightIslands({ Test: registration() }, doc);
    expect(code(results[0]!)).toBe('FORMA_E_ISLAND_STATE'); valid(results[1]!);
  });
  it.each(['00', '+0', '-0', '1.0', '1e0', ' 0', '0 ', '', '9007199254740992', '7'])('refuses noncanonical or out-of-range occurrence %s', index => {
    expect(code(preflightIslands({ Test: registration() }, page(envelope(), host(index)))[0]!)).toBe('FORMA_E_ISLAND_IDENTITY');
  });
  it('refuses all duplicate claims across the original document even when requesting one subtree', () => {
    const doc = page(envelope([{}, {}]), `<section>${host(0)}</section><article>${host(0)}${host(1)}</article>`);
    const registry = { Test: registration() };
    expect(code(preflightIslands(registry, doc.querySelector('section')!)[0]!)).toBe('FORMA_E_ISLAND_IDENTITY');
    const rest = preflightIslands(registry, doc.querySelector('article')!);
    expect(code(rest[0]!)).toBe('FORMA_E_ISLAND_IDENTITY'); valid(rest[1]!);
  });
  it('refuses an injected host even if it claims an unused valid occurrence', () => {
    const doc = page(envelope([{}, {}])); const registry = { Test: registration() };
    valid(preflightIslands(registry, doc)[0]!);
    doc.body.insertAdjacentHTML('beforeend', host(1));
    expect(code(preflightIslands(registry, doc)[1]!)).toBe('FORMA_E_ISLAND_IDENTITY');
  });
  it.each(['data-forma-state', 'data-forma-component', 'data-forma-h'])('freezes %s and rechecks it before deferred activation', attr => {
    const doc = page(), registry = { Test: registration() };
    const checked = valid(preflightIslands(registry, doc)[0]!);
    checked.host.setAttribute(attr, 'changed');
    expect(() => checkIslandClaim(checked)).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(code(preflightIslands(registry, doc)[0]!)).toBe('FORMA_E_ISLAND_IDENTITY');
  });
  it('refuses a copied validation object or a host moved to another Document before activation', () => {
    const doc = page(), registry = { Test: registration() };
    const checked = valid(preflightIslands(registry, doc)[0]!);
    expect(() => checkIslandClaim({ ...checked })).toThrow('FORMA_E_ISLAND_IDENTITY');
    const other = page(); other.body.replaceChildren(other.adoptNode(checked.host));
    expect(() => checkIslandClaim(checked)).toThrow('FORMA_E_ISLAND_IDENTITY');
  });
  it('compares root, entry and compiled digests independently', () => {
    const compiled = registration();
    expect(code(preflightIslands({ Test: compiled }, page(envelope(), host(0, 'Test', OTHER)))[0]!)).toBe('FORMA_E_ISLAND_IDENTITY');
    expect(code(preflightIslands({ Test: compiled }, page({ v: 1, s: [], i: [{ h: OTHER, p: {} }] }))[0]!)).toBe('FORMA_E_ISLAND_IDENTITY');
    const wrong = __islandRegistration(() => {}, { h: OTHER, schema: empty, mode: 0 });
    expect(code(preflightIslands({ Test: wrong }, page())[0]!)).toBe('FORMA_E_ISLAND_IDENTITY');
  });
  it('requires an own compiled registration, never an inherited name or bare callback', () => {
    expect(code(preflightIslands(Object.create({ Test: registration() }), page())[0]!)).toBe('FORMA_E_ISLAND_REGISTRATION');
    expect(code(preflightIslands({ Test: vi.fn() }, page())[0]!)).toBe('FORMA_E_ISLAND_REGISTRATION');
  });
});

describe('bounded schema projection without side effects', () => {
  it.each([
    [{ kind: 'string' }, 7], [{ kind: 'number' }, '7'], [{ kind: 'number' }, null], [{ kind: 'number' }, Infinity],
    [{ kind: 'date' }, 0.5], [{ kind: 'date' }, 8.64e15 + 1], [{ kind: 'enum', variants: ['a'] }, 'b'],
    [{ kind: 'array', element: { kind: 'string' } }, ['a', null]],
  ] as [IslandSchemaType, unknown][])('refuses wrong values for %j', (type, value) => {
    expect(code(preflightIslands({ Test: registration(schema(type)) }, page(envelope([{ value }])))[0]!)).toBe('FORMA_E_ISLAND_SCHEMA');
  });
  it('omits null optional object fields but preserves null array positions and reconstructs Date only by schema', () => {
    const shape: IslandSchema = [[{ name: 'optional', type: { kind: 'optional', inner: { kind: 'string' } } },
      { name: 'dates', type: { kind: 'array', element: { kind: 'optional', inner: { kind: 'date' } } } },
      { name: 'createdAt', type: { kind: 'number' } }]];
    const props = valid(preflightIslands({ Test: registration(shape) }, page(envelope([{ optional: null, dates: [0, null, 1], createdAt: 7 }])))[0]!).props;
    expect(props).toEqual({ dates: [new Date(0), null, new Date(1)], createdAt: 7 });
    expect(ownKeys(props)).toEqual(['dates', 'createdAt']);
  });
  it('strips every-depth forbidden and undeclared fields and shares no mutable objects between occurrences', () => {
    const shape: IslandSchema = [[{ name: 'nested', type: { kind: 'object', object: 1 } }], [{ name: 'values', type: { kind: 'array', element: { kind: 'date' } } }]];
    const input = JSON.parse('{"nested":{"values":[0],"__proto__":{"x":1},"constructor":{"x":1},"prototype":{"x":1}},"__proto__":{"x":1}}');
    const doc = page(envelope([input, input]), host(0) + host(1));
    const results = preflightIslands({ Test: registration(shape) }, doc).map(valid);
    const a = results[0]!.props.nested as { values: Date[] }, b = results[1]!.props.nested as { values: Date[] };
    expect(a).not.toBe(b); expect(a.values).not.toBe(b.values); expect(a.values[0]).not.toBe(b.values[0]);
    expect(Object.getPrototypeOf(a)).toBeNull(); expect(ownKeys(a)).toEqual(['values']);
    a.values[0]!.setTime(1001); expect(b.values[0]!.getTime()).toBe(0);
  });
  it('does not recursively traverse undeclared deep data or overflow on a deep declared schema', () => {
    const deepExtra = '{"v":1,"s":[],"i":[{"h":"' + H + '","p":{"unused":' + '['.repeat(10000) + '0' + ']'.repeat(10000) + '}}]}';
    valid(preflightIslands({ Test: registration() }, page(undefined, host(0), deepExtra))[0]!);
    const objects: { name: string; type: IslandSchemaType }[][] = Array.from({ length: 1000 }, (_, i) => i === 999 ? [] : [{ name: 'next', type: { kind: 'object', object: i + 1 } }]);
    const text = '{"v":1,"s":[],"i":[{"h":"' + H + '","p":' + '{"next":'.repeat(999) + '{}' + '}'.repeat(999) + '}]}';
    const checked = valid(preflightIslands({ Test: registration(objects) }, page(undefined, host(0), text))[0]!);
    let value = checked.props, depth = 0;
    while (Object.hasOwn(value, 'next')) { value = value.next as Record<string, unknown>; depth++; }
    expect(depth).toBe(999); expect(Object.keys(value)).toEqual([]);
  });
  it('accepts a valid 70100-field schema below the reviewed byte cap', () => {
    const objects: { name: string; type: IslandSchemaType }[][] = [Array.from({ length: 100 }, (_, i) => ({ name: `child${String(i).padStart(3, '0')}`, type: { kind: 'object', object: i + 1 } }))];
    for (let i = 0; i < 100; i++) objects.push(Array.from({ length: 700 }, (_, j) => ({ name: j === 0 ? `a${String(i).padStart(3, '0')}` : `f${String(j).padStart(3, '0')}`, type: { kind: 'optional', inner: { kind: 'boolean' } } })));
    expect(objects.reduce((total, fields) => total + fields.length, 0)).toBe(70100);
    const props = Object.fromEntries(objects[0]!.map(field => [field.name, {}]));
    const decoded = valid(preflightIslands({ Test: registration(objects) }, page(envelope([props])))[0]!).props;
    expect(Object.keys(decoded)).toHaveLength(100);
    expect(Object.values(decoded).every(value => Object.keys(value as object).length === 0)).toBe(true);
  });
  it('checks exact schema wire bytes at one MiB and one byte above', () => {
    const fields = Array.from({ length: 16 }, (_, i) => ({ name: String.fromCharCode(97 + i) + 'x'.repeat(i === 15 ? 65497 : 65534), type: { kind: 'boolean' as const } }));
    const wireBytes = 3 + 2 + fields.reduce((n, field) => n + 2 + new TextEncoder().encode(field.name).length + 1, 0);
    expect(wireBytes).toBe(1048576);
    expect(typeof registration([fields])).toBe('function');
    fields[15]!.name += 'x';
    expect(() => registration([fields])).toThrow('FORMA_E_ISLAND_REGISTRATION');
    expect(() => registration([[{ name: '\ud800', type: { kind: 'boolean' } }]])).toThrow('FORMA_E_ISLAND_REGISTRATION');
  });
  it('copies compiled metadata and refuses cyclic or forbidden schemas', () => {
    const shape: { name: string; type: IslandSchemaType }[][] = [[{ name: 'value', type: { kind: 'string' } }]];
    const compiled = registration(shape); shape[0]![0]!.name = 'changed';
    expect(valid(preflightIslands({ Test: compiled }, page(envelope([{ value: 'safe' }])))[0]!).props.value).toBe('safe');
    expect(() => registration([[{ name: 'constructor', type: { kind: 'string' } }]])).toThrow('FORMA_E_ISLAND_REGISTRATION');
    expect(() => registration([[{ name: 'self', type: { kind: 'object', object: 0 } }]])).toThrow('FORMA_E_ISLAND_REGISTRATION');
  });
  it('performs zero DOM writes, calls, effects or trigger installation while preflighting success and refusals', () => {
    const doc = page(envelope([{}, {}]), host(0) + host(1, 'Missing'));
    const before = doc.documentElement.outerHTML;
    const component = vi.fn(); const registry = { Test: registration(empty, component) };
    const observer = new MutationObserver(() => {}); observer.observe(doc, { childList: true, attributes: true, characterData: true, subtree: true });
    const add = vi.spyOn(doc.querySelector('[data-forma-island]')!, 'addEventListener');
    const results = preflightIslands(registry, doc); valid(results[0]!); code(results[1]!);
    expect(doc.documentElement.outerHTML).toBe(before); expect(observer.takeRecords()).toEqual([]);
    expect(component).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled(); observer.disconnect();
  });
  it('unary compiled factory gets checked props once and retains captured getter identity in both modes', () => {
    const captured = () => 7;
    for (const mode of [0, 1] as const) {
      const component = vi.fn((props: any) => ({ props, captured }));
      const checked = valid(preflightIslands({ Test: registration(schema({ kind: 'number' }), component, mode) }, page(envelope([{ value: 1001 }])))[0]!);
      expect(component).not.toHaveBeenCalled();
      const returned = checked.registration.hydrate(checked.host, checked.props) as any;
      expect(component).toHaveBeenCalledExactlyOnceWith(checked.props);
      expect(returned.captured).toBe(captured); expect(returned.props.value).toBe(1001); expect(checked.registration.mode).toBe(mode);
    }
  });
});
function ownKeys(value: object): string[] { return Object.keys(value); }
