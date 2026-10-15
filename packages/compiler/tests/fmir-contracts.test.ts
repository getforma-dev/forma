import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalIslandSchema, encodeBindings, encodeClosedConstant, encodeIslandContracts, makeIslandContract, type BindingRecord, type BindingValue } from '../src/fmir-contracts.js';
import type { PropsSchema, SchemaField, SchemaType } from '../src/fmir-payload.js';

const vectors = JSON.parse(readFileSync(new URL('../../../docs/proposals/FORMA-103-WIRE-VECTORS.json', import.meta.url), 'utf8')).vectors as { name: string; bindingHex: string; schemaHex: string; digestHex: string; sectionHex: string }[];
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const field = (name: string, type: SchemaType): SchemaField => ({ name, type, file: 'original.tsx', line: 1, column: 1 });
const prop = (...path: string[]): BindingValue => ({ kind: 'prop', path });
const signal = (id: number): BindingValue => ({ kind: 'signal', id, path: [] });
const capture = (id: number): BindingValue => ({ kind: 'capture', id, path: [] });
const text = (value: BindingValue): BindingRecord => ({ kind: 'text', value });
const seed = (value: BindingValue): BindingRecord => ({ kind: 'signal', value });
const captured = (value: unknown): BindingRecord => ({ kind: 'capture', value });
const aggregate = { items: [1, null, { name: 'two' }], ready: true };
const inputs: { schema: PropsSchema; records: BindingRecord[]; constants?: Map<number, unknown>; mode?: 'browserOnly' }[] = [
  { schema: [[]], records: [] },
  { schema: [[field('hits', { kind: 'optional', inner: { kind: 'number' } })]], records: [seed({ kind: 'nullish', source: prop('hits'), fallback: 42 }), seed({ kind: 'nullish', source: prop('hits'), fallback: 42 }), text(signal(0)), text(signal(1))], constants: new Map([[2, 42]]) },
  { schema: [[field('left', { kind: 'string' }), field('right', { kind: 'string' })]], records: [text(prop('left')), text(prop('right'))] },
  { schema: [[field('rows', { kind: 'array', element: { kind: 'object', object: 1 } })], [field('id', { kind: 'number' }), field('profile', { kind: 'object', object: 2 })], [field('name', { kind: 'string' })]], records: [{ kind: 'list', value: prop('rows'), key: ['id'], body: [{ kind: 'child', name: 'Badge', fields: [{ name: 'label', value: { kind: 'row', id: 0, path: ['profile', 'name'] } }] }] }] },
  { schema: [[field('label', { kind: 'optional', inner: { kind: 'string' } })]], records: [seed({ kind: 'nullish', source: prop('label'), fallback: '' }), text(signal(0))], constants: new Map([[2, '']]) },
  { schema: [[field('\u{10000}', { kind: 'string' }), field('\ue000', { kind: 'enum', variants: ['é', 'e\u0301', ''] })]], records: [] },
  { schema: [[]], records: [seed({ kind: 'constant', value: aggregate })], constants: new Map([[2, aggregate]]) },
  { schema: [[field('title', { kind: 'optional', inner: { kind: 'string' } })]], mode: 'browserOnly', records: [] },
  { schema: [[]], records: [captured(1), text(capture(0)), text(capture(0))] },
  { schema: [[]], records: [captured(1), captured(1), text(capture(0)), text(capture(1))] },
  { schema: [[]], records: [captured(1), text(capture(0)), text(capture(0))] },
];

describe('canonical island contract writer', () => {
  for (const [index, vector] of vectors.entries()) it(`matches reviewed bytes: ${vector.name}`, () => {
    const input = inputs[index]!;
    const contract = makeIslandContract(7, input.schema, 0, input.mode ?? 'ssr', input.records);
    expect(hex(contract.bindingBytes)).toBe(vector.bindingHex);
    expect(hex(contract.schemaBytes)).toBe(vector.schemaHex);
    expect(hex(contract.digest)).toBe(vector.digestHex);
    expect(hex(encodeIslandContracts([contract], input.constants ?? new Map()))).toBe(vector.sectionHex);
  });

  it('deduplicates structural objects independently of global ids, field order and source positions', () => {
    const a: PropsSchema = [[field('b', { kind: 'object', object: 2 }), field('a', { kind: 'object', object: 1 })], [field('state', { kind: 'enum', variants: ['z', 'a'] })], [field('state', { kind: 'enum', variants: ['a', 'z'] })]];
    const b: PropsSchema = [[{ ...field('state', { kind: 'enum', variants: ['a', 'z'] }), file: 'elsewhere.ts', line: 92 }], [field('a', { kind: 'object', object: 0 }), field('b', { kind: 'object', object: 0 })]];
    const first = canonicalIslandSchema(a, 0), second = canonicalIslandSchema(b, 1);
    expect(first.objects).toHaveLength(2);
    expect(hex(first.bytes)).toBe(hex(second.bytes));
  });

  it('bounds consecutive wrappers independently of acyclic object depth', () => {
    const array = (count: number): SchemaType => { let t: SchemaType = { kind: 'number' }; while (count--) t = { kind: 'array', element: t }; return t; };
    expect(() => canonicalIslandSchema([[field('x', array(16))]], 0)).not.toThrow();
    expect(() => canonicalIslandSchema([[field('x', array(17))]], 0)).toThrow(/16|wrapper|nesting/);
    const deep = Array.from({ length: 24 }, (_, i) => [field('x', i === 23 ? { kind: 'string' } : { kind: 'object', object: i + 1 })]);
    expect(canonicalIslandSchema(deep, 0).objects).toHaveLength(24);
    expect(() => canonicalIslandSchema([[field('x', { kind: 'object', object: 0 })]], 0)).toThrow(/cycl/);
  });

  for (const name of ['__proto__', 'constructor', 'prototype']) it(`refuses declared reserved key ${name} at any depth`, () => {
    expect(() => canonicalIslandSchema([[field('child', { kind: 'object', object: 1 })], [field(name, { kind: 'string' })]], 0)).toThrow(/reserved|forbidden/);
  });

  it('preserves finite f64 values and rejects lossy UTF-16 replacement', () => {
    for (const value of [NaN, Infinity, -Infinity]) expect(() => encodeClosedConstant(value)).toThrow(/finite/);
    expect(hex(encodeClosedConstant(-0))).toBe(hex(encodeClosedConstant(0)));
    expect(hex(encodeClosedConstant(''))).toBe('040000');
    expect(hex(encodeClosedConstant([null, 1]))).toBe('05020000000003000000000000f03f');
    expect(() => encodeClosedConstant('\ud800')).toThrow(/UTF-16|surrogate/);
    expect(() => canonicalIslandSchema([[field('\udc00', { kind: 'string' })]], 0)).toThrow(/UTF-16|surrogate/);
  });

  it('checks aggregate budgets, cycles and data descriptors before encoding', () => {
    let deep: unknown = 0; for (let i = 0; i < 10000; i++) deep = [deep];
    expect(() => encodeClosedConstant(deep)).toThrow(/depth/);
    expect(() => encodeClosedConstant(Array(65536).fill(null))).toThrow(/element|node/);
    expect(() => encodeClosedConstant(Array(17).fill('x'.repeat(65535)))).toThrow(/byte|size/);
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    expect(() => encodeClosedConstant(cycle)).toThrow(/cycl/);
    let touched = false;
    const accessor = { get x() { touched = true; return 1; } };
    expect(() => encodeClosedConstant(accessor)).toThrow(/data|accessor/);
    expect(touched).toBe(false);
    expect(() => encodeClosedConstant(aggregate)).not.toThrow();
  });

  it('validates lexical dominance, capture identity order and mode', () => {
    expect(() => encodeBindings('ssr', [text(signal(0))])).toThrow(/signal/);
    expect(() => encodeBindings('ssr', [text({ kind: 'row', id: 0, path: [] })])).toThrow(/row/);
    expect(() => encodeBindings('ssr', [captured(1), captured(1), text(capture(1)), text(capture(0))])).toThrow(/capture/);
    expect(() => encodeBindings('ssr', [captured(1)])).toThrow(/capture/);
    expect(() => encodeBindings('ssr', [seed({ kind: 'constant', value: 1 }), captured(1), text(capture(0))])).toThrow(/prefix/);
    expect(() => encodeBindings('ssr', [{ kind: 'show', value: { kind: 'constant', value: true }, then: [seed({ kind: 'constant', value: 1 })], else: [text(signal(0))] }])).toThrow(/signal/);
    expect(() => encodeBindings('browserOnly', [text({ kind: 'constant', value: 1 })])).toThrow(/browserOnly/);
    expect(hex(encodeBindings('browserOnly', []))).toBe('01010000');
  });

  it('normalizes optional wrappers but preserves array position semantics', () => {
    const string: SchemaType = { kind: 'string' };
    const optional: SchemaType = { kind: 'optional', inner: string };
    const a = canonicalIslandSchema([[field('x', { kind: 'optional', inner: optional })]], 0);
    const b = canonicalIslandSchema([[field('x', optional)]], 0);
    expect(hex(a.bytes)).toBe(hex(b.bytes));
    const positions = canonicalIslandSchema([[field('x', { kind: 'array', element: optional })]], 0);
    const container = canonicalIslandSchema([[field('x', { kind: 'optional', inner: { kind: 'array', element: string } })]], 0);
    expect(hex(positions.bytes)).not.toBe(hex(container.bytes));
    expect(() => canonicalIslandSchema([[field('x', { kind: 'enum', variants: [] })]], 0)).toThrow(/variant/);
    expect(() => canonicalIslandSchema([[field('x', { kind: 'enum', variants: ['a', 'a'] })]], 0)).toThrow(/duplicate/);
    expect(() => canonicalIslandSchema([[field('x', string), field('x', string)]], 0)).toThrow(/duplicate/);
  });

  it('keeps shared aggregate values while refusing holes and non-data objects', () => {
    const shared = { name: 'shared' };
    expect(hex(encodeClosedConstant([shared, shared]))).toBe(hex(encodeClosedConstant([{ name: 'shared' }, { name: 'shared' }])));
    expect(() => encodeClosedConstant(Array(1))).toThrow(/dense/);
    expect(() => encodeClosedConstant(new Date())).toThrow(/plain/);
    expect(() => encodeClosedConstant({ [Symbol('private')]: 1 })).toThrow(/symbol/);
    expect(() => encodeClosedConstant({ x: undefined })).toThrow(/closed/);
    expect(() => encodeClosedConstant('😀'.repeat(16384))).toThrow(/byte length/);
    expect(() => encodeClosedConstant(Array(65534).fill(null))).not.toThrow();
    expect(() => encodeClosedConstant(Array(65535).fill(null))).toThrow(/node count/);
    let atLimit: unknown = 1; for (let i = 0; i < 1024; i++) atLimit = [atLimit];
    expect(() => encodeClosedConstant(atLimit)).not.toThrow();
    expect(() => encodeClosedConstant([atLimit])).toThrow(/depth/);
  });

  it('checks expression, block and list depths at their exact boundary', () => {
    let value: BindingValue = { kind: 'constant', value: false };
    for (let i = 0; i < 64; i++) value = { kind: 'unary', operator: '!', value };
    expect(() => encodeBindings('ssr', [text(value)])).not.toThrow();
    expect(() => encodeBindings('ssr', [text({ kind: 'unary', operator: '!', value })])).toThrow(/value depth/);
    let blocks: BindingRecord[] = [];
    for (let i = 0; i < 64; i++) blocks = [{ kind: 'show', value: { kind: 'constant', value: true }, then: blocks, else: [] }];
    expect(() => encodeBindings('ssr', blocks)).not.toThrow();
    expect(() => encodeBindings('ssr', [{ kind: 'show', value: { kind: 'constant', value: true }, then: blocks, else: [] }])).toThrow(/block depth/);
    let lists: BindingRecord[] = [];
    for (let i = 0; i < 4; i++) lists = [{ kind: 'list', value: { kind: 'constant', value: [] }, key: [], body: lists }];
    expect(() => encodeBindings('ssr', lists)).not.toThrow();
    expect(() => encodeBindings('ssr', [{ kind: 'list', value: { kind: 'constant', value: [] }, key: [], body: lists }])).toThrow(/list depth/);
    expect(() => encodeBindings('ssr', [text(prop(...Array(1024).fill('x')))])).not.toThrow();
    expect(() => encodeBindings('ssr', [text(prop(...Array(1025).fill('x')))])).toThrow(/path/);
  });

  it('includes operators, dynamic attribute names and canonical child mappings in identity', () => {
    const constant = (value: unknown): BindingValue => ({ kind: 'constant', value });
    const base: BindingRecord[] = [{ kind: 'attribute', name: 'title', value: { kind: 'binary', operator: '+', left: constant('a'), right: constant('b') } }];
    const hash = (records: BindingRecord[]): string => hex(makeIslandContract(0, [[]], 0, 'ssr', records).digest);
    expect(hash(base)).not.toBe(hash([{ ...base[0]!, name: 'class' } as BindingRecord]));
    expect(hash(base)).not.toBe(hash([{ kind: 'attribute', name: 'title', value: { kind: 'binary', operator: '-', left: constant('a'), right: constant('b') } }]));
    const fields = [{ name: 'b', value: constant(2) }, { name: 'a', value: constant(1) }];
    expect(hash([{ kind: 'child', name: 'Badge', fields }])).toBe(hash([{ kind: 'child', name: 'Badge', fields: [...fields].reverse() }]));
    expect(() => encodeBindings('ssr', [{ kind: 'child', name: 'Badge', fields: [fields[0]!, fields[0]!] }])).toThrow(/duplicate/);
    const contract = makeIslandContract(7, [[]], 0, 'ssr', []);
    expect(() => encodeIslandContracts([contract, contract], new Map())).toThrow(/duplicate/);
    expect(hex(encodeIslandContracts([], new Map()))).toBe('00000000');
    const same = makeIslandContract(0, [[]], 0, 'ssr', []);
    expect(hex(contract.digest)).toBe(hex(same.digest));
  });
});
