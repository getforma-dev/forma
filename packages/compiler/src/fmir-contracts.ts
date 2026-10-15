/** Canonical island metadata. These bytes describe bindings; they do not evaluate them. */
import { createHash } from 'node:crypto';
import * as C from './fmir-constants.js';
import type { PropsSchema, SchemaType } from './fmir-payload.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw Object.assign(new Error(`FMIR island contract: ${message}`), { code: 'BUILD-610' });
}
function unsigned(value: number, maximum: number, label: string): void {
  check(Number.isInteger(value) && value >= 0 && value <= maximum, `${label} is outside 0..${maximum}`);
}
const encoder = new TextEncoder();
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function utf8(value: string): Uint8Array {
  check(typeof value === 'string', 'text must be a string');
  // TextEncoder replaces lone surrogates. Refuse them before identity can be lost.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      check(next >= 0xdc00 && next <= 0xdfff, 'unpaired UTF-16 surrogate');
    } else check(c < 0xdc00 || c > 0xdfff, 'unpaired UTF-16 surrogate');
  }
  // UTF-8 never has fewer bytes than UTF-16 code units for well-formed text.
  check(value.length <= 65535, 'text byte length exceeds 65535');
  const bytes = encoder.encode(value);
  check(bytes.length <= 65535, 'text byte length exceeds 65535');
  return bytes;
}
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
function sortedNames<T>(items: readonly T[], name: (value: T) => string): T[] {
  return items.map(value => ({ value, bytes: utf8(name(value)) }))
    .sort((a, b) => compareBytes(a.bytes, b.bytes)).map(item => item.value);
}
class Writer {
  private readonly bytes: number[] = [];
  constructor(private readonly limit = C.MAX_CONTRACT_BYTES) {}
  private reserve(count: number): void { check(count <= this.limit - this.bytes.length, `byte size exceeds ${this.limit}`); }
  u8(n: number): void { unsigned(n, 255, 'u8'); this.reserve(1); this.bytes.push(n); }
  u16(n: number): void { unsigned(n, 65535, 'u16'); this.reserve(2); this.bytes.push(n & 255, n >>> 8); }
  u32(n: number): void { unsigned(n, 0xffffffff, 'u32'); this.reserve(4); this.bytes.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24); }
  raw(bytes: Uint8Array): void { this.reserve(bytes.length); for (const byte of bytes) this.bytes.push(byte); }
  text(value: string): void { const bytes = utf8(value); this.u16(bytes.length); this.raw(bytes); }
  f64(value: number): void {
    check(Number.isFinite(value), 'constant number must be finite');
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, Object.is(value, -0) ? 0 : value, true);
    this.raw(bytes);
  }
  finish(): Uint8Array { return Uint8Array.from(this.bytes); }
}

/** Encode bounded plain closed data without recursion or executing accessors. */
export function encodeClosedConstant(value: unknown): Uint8Array {
  const out = new Writer();
  type Work = { kind: 'value'; value: unknown; depth: number } | { kind: 'text'; text: string } | { kind: 'exit'; object: object };
  const pending: Work[] = [{ kind: 'value', value, depth: 0 }];
  const active = new Set<object>();
  let nodes = 1;
  while (pending.length) {
    const next = pending.pop()!;
    if (next.kind === 'text') { out.text(next.text); continue; }
    if (next.kind === 'exit') { active.delete(next.object); continue; }
    check(next.depth <= C.MAX_CONSTANT_DEPTH, 'constant depth exceeds 1024');
    const item = next.value;
    if (item === null) { out.u8(0); continue; }
    if (typeof item === 'boolean') { out.u8(item ? 2 : 1); continue; }
    if (typeof item === 'number') { out.u8(3); out.f64(item); continue; }
    if (typeof item === 'string') { out.u8(4); out.text(item); continue; }
    check(typeof item === 'object', 'constant must contain only closed data');
    check(!active.has(item), 'constant reference cycle');
    active.add(item); pending.push({ kind: 'exit', object: item });
    if (Array.isArray(item)) {
      check(item.length <= C.MAX_CONSTANT_ARRAY_ELEMENTS, 'constant array element count exceeds 65535');
      check(item.length <= C.MAX_CONSTANT_NODES - nodes, 'constant node count exceeds 65535');
      nodes += item.length;
      // Arrays have dense own data positions only, without custom properties.
      check(Reflect.ownKeys(item).length === item.length + 1, 'constant array must be dense plain data');
      out.u8(5); out.u32(item.length);
      for (let i = item.length - 1; i >= 0; i--) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        check(descriptor && 'value' in descriptor, 'constant array positions must be own data');
        pending.push({ kind: 'value', value: descriptor.value, depth: next.depth + 1 });
      }
    } else {
      const prototype = Object.getPrototypeOf(item);
      check(prototype === Object.prototype || prototype === null, 'constant object must be plain data');
      const names = Reflect.ownKeys(item);
      check(names.length <= C.MAX_SCHEMA_ITEMS, 'constant object field count exceeds 1024');
      check(names.every(name => typeof name === 'string'), 'constant symbol fields are unsupported');
      check(names.length <= C.MAX_CONSTANT_NODES - nodes, 'constant node count exceeds 65535');
      nodes += names.length;
      const sorted = sortedNames(names as string[], name => name);
      out.u8(6); out.u16(sorted.length);
      for (let i = sorted.length - 1; i >= 0; i--) {
        const name = sorted[i]!;
        const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
        check('value' in descriptor && descriptor.enumerable, 'constant fields must be enumerable data, not accessors');
        pending.push({ kind: 'value', value: descriptor.value, depth: next.depth + 1 });
        pending.push({ kind: 'text', text: name });
      }
    }
  }
  return out.finish();
}

export interface CanonicalField { readonly name: string; readonly type: SchemaType }
export type CanonicalSchema = readonly (readonly CanonicalField[])[];

function normalizedType(type: SchemaType, objectCount: number): SchemaType {
  const wrappers: ('array' | 'optional')[] = [], seen = new Set<SchemaType>();
  let current = type;
  while (current.kind === 'array' || current.kind === 'optional') {
    check(!seen.has(current), 'schema wrapper cycle'); seen.add(current);
    if (current.kind !== 'optional' || wrappers[wrappers.length - 1] !== 'optional') wrappers.push(current.kind);
    check(wrappers.length <= C.MAX_TYPE_DEPTH, 'schema wrapper nesting exceeds 16');
    current = current.kind === 'array' ? current.element : current.inner;
  }
  let result: SchemaType;
  switch (current.kind) {
    case 'boolean': case 'string': case 'number': case 'date': result = { kind: current.kind }; break;
    case 'enum': {
      check(current.variants.length >= 1 && current.variants.length <= C.MAX_SCHEMA_ITEMS, 'enum needs 1..1024 variants');
      const variants = sortedNames(current.variants, value => value);
      check(new Set(variants).size === variants.length, 'duplicate enum variant');
      result = { kind: 'enum', variants }; break;
    }
    case 'object': unsigned(current.object, objectCount - 1, 'schema object index'); result = { kind: 'object', object: current.object }; break;
    default: throw Object.assign(new Error('FMIR island contract: unknown schema type'), { code: 'BUILD-610' });
  }
  for (let i = wrappers.length - 1; i >= 0; i--) result = wrappers[i] === 'array' ? { kind: 'array', element: result } : { kind: 'optional', inner: result };
  return result;
}
function objectReference(type: SchemaType): number | undefined {
  let current = type;
  while (current.kind === 'array' || current.kind === 'optional') current = current.kind === 'array' ? current.element : current.inner;
  return current.kind === 'object' ? current.object : undefined;
}
function remapType(type: SchemaType, remap: (id: number) => number): SchemaType {
  switch (type.kind) {
    case 'object': return { kind: 'object', object: remap(type.object) };
    case 'array': return { kind: 'array', element: remapType(type.element, remap) };
    case 'optional': return { kind: 'optional', inner: remapType(type.inner, remap) };
    default: return type;
  }
}
function writeType(out: Writer, type: SchemaType): void {
  switch (type.kind) {
    case 'boolean': out.u8(1); break;
    case 'string': out.u8(2); break;
    case 'number': out.u8(3); break;
    case 'date': out.u8(4); break;
    case 'enum': out.u8(5); out.u16(type.variants.length); for (const variant of type.variants) out.text(variant); break;
    case 'array': out.u8(6); writeType(out, type.element); break;
    case 'optional': out.u8(7); writeType(out, type.inner); break;
    case 'object': out.u8(8); out.u16(type.object); break;
  }
}

/** Root-first structural numbering, independent of diagnostic/global table numbering. */
export function canonicalIslandSchema(schema: PropsSchema, root: number): { objects: CanonicalSchema; bytes: Uint8Array } {
  check(schema.length >= 1 && schema.length <= C.MAX_SCHEMA_ITEMS, 'schema needs 1..1024 objects');
  unsigned(root, schema.length - 1, 'root schema object');
  const normalized = new Map<number, CanonicalField[]>(), dependencies = new Map<number, Set<number>>();
  const pending = [root];
  while (pending.length) {
    const id = pending.pop()!;
    if (normalized.has(id)) continue;
    const fields = schema[id]!;
    check(fields.length <= C.MAX_SCHEMA_ITEMS, 'schema object field count exceeds 1024');
    const names = new Set<string>();
    const sorted = sortedNames(fields, field => field.name).map(field => {
      check(!forbidden.has(field.name), `forbidden declared field ${field.name}`);
      check(!names.has(field.name), `duplicate schema field ${field.name}`); names.add(field.name);
      return { name: field.name, type: normalizedType(field.type, schema.length) };
    });
    normalized.set(id, sorted);
    const edges = new Set<number>();
    for (const field of sorted) { const child = objectReference(field.type); if (child !== undefined) { edges.add(child); pending.push(child); } }
    dependencies.set(id, edges);
  }
  // Build structural ids bottom-up. Memoization avoids expanding shared subgraphs.
  const remaining = new Map<number, number>(), parents = new Map<number, number[]>();
  const ready: number[] = [];
  for (const [id, edges] of dependencies) {
    remaining.set(id, edges.size);
    if (!edges.size) ready.push(id);
    for (const child of edges) { const refs = parents.get(child) ?? []; refs.push(id); parents.set(child, refs); }
  }
  const structural = new Map<number, number>(), signatures = new Map<string, number>(), shapes: CanonicalField[][] = [];
  while (ready.length) {
    const id = ready.pop()!;
    const fields = normalized.get(id)!.map(field => ({ name: field.name, type: remapType(field.type, child => structural.get(child)!) }));
    const signature = JSON.stringify(fields);
    let shape = signatures.get(signature);
    if (shape === undefined) { shape = shapes.length; shapes.push(fields); signatures.set(signature, shape); }
    structural.set(id, shape);
    for (const parent of parents.get(id) ?? []) {
      const left = remaining.get(parent)! - 1; remaining.set(parent, left);
      if (!left) ready.push(parent);
    }
  }
  check(structural.size === normalized.size, 'schema object reference cycle');
  const localIds = new Map<number, number>(), order: number[] = [], visit = [structural.get(root)!];
  while (visit.length) {
    const id = visit.pop()!;
    if (localIds.has(id)) continue;
    localIds.set(id, order.length); order.push(id);
    const fields = shapes[id]!;
    for (let i = fields.length - 1; i >= 0; i--) { const child = objectReference(fields[i]!.type); if (child !== undefined) visit.push(child); }
  }
  const objects = order.map(id => shapes[id]!.map(field => ({ name: field.name, type: remapType(field.type, child => localIds.get(child)!) })));
  const out = new Writer(); out.u8(1); out.u16(objects.length);
  for (const fields of objects) { out.u16(fields.length); for (const field of fields) { out.text(field.name); writeType(out, field.type); } }
  return { objects, bytes: out.finish() };
}

export type UnaryBindingOperator = '!' | '+' | '-';
export type BinaryBindingOperator = '+' | '-' | '*' | '/' | '%' | '**' | '===' | '!==' | '<' | '<=' | '>' | '>=' | '&&' | '||';
export type BindingValue =
  | { kind: 'constant'; value: unknown }
  | { kind: 'prop'; path: readonly string[] }
  | { kind: 'signal' | 'row' | 'capture'; id: number; path: readonly string[] }
  | { kind: 'nullish'; source: BindingValue; fallback: unknown }
  | { kind: 'unary'; operator: UnaryBindingOperator; value: BindingValue }
  | { kind: 'binary'; operator: BinaryBindingOperator; left: BindingValue; right: BindingValue };
export type BindingRecord =
  | { kind: 'signal' | 'text'; value: BindingValue }
  | { kind: 'attribute'; name: string; value: BindingValue }
  | { kind: 'show'; value: BindingValue; then: readonly BindingRecord[]; else: readonly BindingRecord[] }
  | { kind: 'list'; value: BindingValue; key: readonly string[]; body: readonly BindingRecord[] }
  | { kind: 'child'; name: string; fields: readonly { name: string; value: BindingValue }[] }
  | { kind: 'capture'; value: unknown };
export type IslandRenderMode = 'ssr' | 'browserOnly';
interface Scope { signals: Set<number>; rows: Set<number> }
const unary: readonly string[] = ['!', '+', '-'];
const binary: readonly string[] = ['+', '-', '*', '/', '%', '**', '===', '!==', '<', '<=', '>', '>=', '&&', '||'];

/** Validate lexical identities while serializing the reviewed metadata grammar. */
export function encodeBindings(mode: IslandRenderMode, records: readonly BindingRecord[]): Uint8Array {
  check(mode === 'ssr' || mode === 'browserOnly', 'unknown render mode');
  check(mode !== 'browserOnly' || records.length === 0, 'browserOnly bindings must be empty');
  let captures = 0;
  while (records[captures]?.kind === 'capture') captures++;
  const usedCaptures = new Set<number>();
  let recordCount = 0, signalCount = 0, rowCount = 0;
  function value(out: Writer, input: BindingValue, scope: Scope, depth = 0): void {
    check(depth <= C.MAX_VALUE_DEPTH, 'binding value depth exceeds 64');
    switch (input.kind) {
      case 'constant': out.u8(0); out.raw(encodeClosedConstant(input.value)); break;
      case 'prop': case 'signal': case 'row': case 'capture': {
        if (input.kind !== 'prop') {
          unsigned(input.id, 65535, `${input.kind} ordinal`);
          if (input.kind === 'signal') check(scope.signals.has(input.id), `signal ${input.id} does not dominate this use`);
          else if (input.kind === 'row') check(scope.rows.has(input.id), `row ${input.id} is outside its list body`);
          else {
            check(input.id < captures, `capture ${input.id} is undeclared`);
            if (!usedCaptures.has(input.id)) { check(input.id === usedCaptures.size, 'capture first-use order must follow prefix ordinals'); usedCaptures.add(input.id); }
          }
        }
        check(input.path.length <= C.MAX_PROP_PATH_SEGMENTS && (input.kind !== 'prop' || input.path.length > 0), 'binding path needs at most 1024 segments and PROP is nonempty');
        out.u8(input.kind === 'prop' ? 1 : input.kind === 'signal' ? 2 : input.kind === 'row' ? 3 : 7);
        if (input.kind !== 'prop') out.u16(input.id);
        out.u16(input.path.length); for (const part of input.path) out.text(part); break;
      }
      case 'nullish': out.u8(4); value(out, input.source, scope, depth + 1); out.raw(encodeClosedConstant(input.fallback)); break;
      case 'unary': {
        const op = unary.indexOf(input.operator); check(op >= 0, 'unsupported unary binding operator');
        out.u8(5); out.u8(op + 1); value(out, input.value, scope, depth + 1); break;
      }
      case 'binary': {
        const op = binary.indexOf(input.operator); check(op >= 0, 'unsupported binary binding operator');
        out.u8(6); out.u8(op + 1); value(out, input.left, scope, depth + 1); value(out, input.right, scope, depth + 1); break;
      }
      default: check(false, 'unknown binding value');
    }
  }
  function block(input: readonly BindingRecord[], parent: Scope, depth: number, listDepth: number): Uint8Array {
    check(depth <= C.MAX_CONTROL_DEPTH, 'binding block depth exceeds 64');
    check(listDepth <= C.MAX_LIST_DEPTH, 'binding list depth exceeds 4');
    check(input.length <= C.MAX_BINDING_RECORDS - recordCount, 'binding record count exceeds 65535'); recordCount += input.length;
    const out = new Writer(); out.u16(input.length);
    const scope = { signals: new Set(parent.signals), rows: new Set(parent.rows) };
    for (const [index, record] of input.entries()) {
      const payload = new Writer();
      switch (record.kind) {
        case 'capture':
          check(depth === 0 && index < captures, 'capture must be in the outermost prefix');
          payload.u8(7); payload.raw(encodeClosedConstant(record.value)); break;
        case 'signal':
          payload.u8(1); value(payload, record.value, scope); scope.signals.add(signalCount++); break;
        case 'text': payload.u8(2); value(payload, record.value, scope); break;
        case 'attribute': payload.u8(3); payload.text(record.name); value(payload, record.value, scope); break;
        case 'show':
          payload.u8(4); value(payload, record.value, scope);
          payload.raw(block(record.then, scope, depth + 1, listDepth)); payload.raw(block(record.else, scope, depth + 1, listDepth)); break;
        case 'list': {
          payload.u8(5); value(payload, record.value, scope);
          check(record.key.length <= C.MAX_KEY_SEGMENTS, 'list key has more than 32 segments');
          payload.u8(record.key.length); for (const part of record.key) payload.text(part);
          const rows = new Set(scope.rows); rows.add(rowCount++);
          payload.raw(block(record.body, { signals: scope.signals, rows }, depth + 1, listDepth + 1)); break;
        }
        case 'child': {
          payload.u8(6); payload.text(record.name);
          check(record.fields.length <= C.MAX_SCHEMA_ITEMS, 'child field count exceeds 1024');
          const fields = sortedNames(record.fields, field => field.name), names = new Set<string>();
          payload.u16(fields.length);
          for (const field of fields) {
            check(!names.has(field.name), 'duplicate child field'); names.add(field.name);
            check(!forbidden.has(field.name), `forbidden declared child field ${field.name}`);
            payload.text(field.name); value(payload, field.value, scope);
          }
          break;
        }
        default: check(false, 'unknown binding record');
      }
      const bytes = payload.finish(); out.u32(bytes.length); out.raw(bytes);
    }
    return out.finish();
  }
  const out = new Writer(); out.u8(1); out.u8(mode === 'browserOnly' ? 1 : 0);
  out.raw(block(records, { signals: new Set(), rows: new Set() }, 0, 0));
  check(usedCaptures.size === captures, 'every capture must be used');
  return out.finish();
}

export interface IslandContract {
  readonly islandId: number;
  readonly schemaObject: number;
  readonly mode: IslandRenderMode;
  readonly schema: CanonicalSchema;
  readonly bindingBytes: Uint8Array;
  readonly schemaBytes: Uint8Array;
  readonly digest: Uint8Array;
}
export function makeIslandContract(islandId: number, schema: PropsSchema, schemaObject: number, mode: IslandRenderMode, bindings: readonly BindingRecord[]): IslandContract {
  unsigned(islandId, 65535, 'island id');
  const canonical = canonicalIslandSchema(schema, schemaObject), bindingBytes = encodeBindings(mode, bindings);
  const digest = new Uint8Array(createHash('sha256').update(bindingBytes).update(canonical.bytes).digest().subarray(0, 8));
  return { islandId, schemaObject, mode, schema: canonical.objects, bindingBytes, schemaBytes: canonical.bytes, digest };
}
export function encodeIslandContracts(contracts: readonly IslandContract[], constants: ReadonlyMap<number, unknown>): Uint8Array {
  check(contracts.length <= C.MAX_ISLANDS, 'island contract count exceeds 4096');
  check(constants.size <= C.MAX_SLOTS, 'closed constant count exceeds 65535');
  const out = new Writer(C.MAX_MODULE_SIZE); out.u16(contracts.length);
  const sorted = [...contracts].sort((a, b) => a.islandId - b.islandId);
  let previous = -1;
  for (const contract of sorted) {
    unsigned(contract.islandId, 65535, 'island id'); check(contract.islandId > previous, 'duplicate island contract'); previous = contract.islandId;
    check(contract.bindingBytes.length >= 4 && contract.bindingBytes.length <= C.MAX_CONTRACT_BYTES, 'binding byte length is invalid');
    check(contract.schemaBytes.length >= 5 && contract.schemaBytes.length <= C.MAX_CONTRACT_BYTES, 'schema byte length is invalid');
    out.u32(10 + contract.bindingBytes.length + contract.schemaBytes.length); out.u16(contract.islandId);
    out.u32(contract.bindingBytes.length); out.raw(contract.bindingBytes); out.u32(contract.schemaBytes.length); out.raw(contract.schemaBytes);
  }
  out.u16(constants.size);
  for (const [id, value] of [...constants].sort((a, b) => a[0] - b[0])) {
    unsigned(id, 65535, 'constant slot id'); const bytes = encodeClosedConstant(value);
    out.u16(id); out.u32(bytes.length); out.raw(bytes);
  }
  return out.finish();
}
