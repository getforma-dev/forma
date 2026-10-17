import * as C from './fmir-constants.js';

export function emissionError(message: string): Error { return Object.assign(new Error(`FMIR: ${message}`), { code: 'BUILD-606' }); }
export function assertEmit(condition: unknown, message: string): asserts condition { if (!condition) throw emissionError(message); }
export function uint(value: number, max: number, label: string): void { assertEmit(Number.isInteger(value) && value >= 0 && value <= max, `${label} must be an integer in 0..${max} (got ${value})`); }
export class PayloadWriter {
  private bytes: number[] = [];
  private reserve(n: number): void { assertEmit(this.bytes.length + n <= C.MAX_MODULE_SIZE, 'payload exceeds module size ceiling'); }
  u8(n: number): void { this.reserve(1); uint(n, 255, 'u8'); this.bytes.push(n); }
  u16(n: number): void { this.reserve(2); uint(n, 65535, 'u16'); this.bytes.push(n & 255, n >>> 8); }
  u32(n: number): void { this.reserve(4); uint(n, 0xffffffff, 'u32'); this.bytes.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24); }
  finish(): Uint8Array { return Uint8Array.from(this.bytes); }
}
export type SchemaType =
  | { kind: 'boolean' | 'string' | 'number' | 'date' }
  | { kind: 'enum'; variants: readonly string[] }
  | { kind: 'array'; element: SchemaType }
  | { kind: 'optional'; inner: SchemaType }
  | { kind: 'object'; object: number };
export interface SchemaField { name: string; file: string; line: number; column: number; type: SchemaType }
export type PropsSchema = readonly (readonly SchemaField[])[];
export interface KeyPath { listOffset: number; segments: readonly string[] }
export interface SourcePosition { opcodeOffset: number; file: string; line: number; column: number; component: string }
export function position(line: number, column: number): void {
  uint(line, 0xffffffff, 'line'); uint(column, 0xffffffff, 'column');
  assertEmit(line > 0 && column > 0, 'line and UTF-16 column are 1-based');
}
export function encodePropsSchema(objects: PropsSchema, intern: (text: string) => number): Uint8Array {
  assertEmit(objects.length >= 1 && objects.length <= C.MAX_SCHEMA_ITEMS, 'props schema needs 1..1024 objects, with page object 0');
  const out = new PayloadWriter(); out.u16(objects.length);
  const graph: Set<number>[] = objects.map(() => new Set());
  const type = (value: SchemaType, object: number, depth: number, parentOptional = false): void => {
    switch (value.kind) {
      case 'boolean': out.u8(C.SCHEMA_BOOLEAN); break;
      case 'string': out.u8(C.SCHEMA_STRING); break;
      case 'number': out.u8(C.SCHEMA_NUMBER); break;
      case 'date': out.u8(C.SCHEMA_DATE); break;
      case 'enum':
        assertEmit(value.variants.length <= C.MAX_SCHEMA_ITEMS, 'enum variant count exceeds 1024');
        out.u8(C.SCHEMA_ENUM); out.u16(value.variants.length);
        for (const variant of value.variants) out.u32(intern(variant));
        break;
      case 'array':
      case 'optional':
        assertEmit(depth < C.MAX_TYPE_DEPTH, 'schema type nesting exceeds 16');
        assertEmit(!(parentOptional && value.kind === 'optional'), 'optional of optional is invalid');
        out.u8(value.kind === 'array' ? C.SCHEMA_ARRAY : C.SCHEMA_OPTIONAL);
        type(value.kind === 'array' ? value.element : value.inner, object, depth + 1, value.kind === 'optional');
        break;
      case 'object':
        uint(value.object, objects.length - 1, 'schema object index');
        out.u8(C.SCHEMA_OBJECT); out.u16(value.object); graph[object]!.add(value.object); break;
      default: throw emissionError('unknown props schema type');
    }
  };
  objects.forEach((fields, object) => {
    assertEmit(fields.length <= C.MAX_SCHEMA_ITEMS, 'schema field count exceeds 1024');
    out.u16(fields.length); const names = new Set<string>();
    for (const field of fields) {
      assertEmit(!names.has(field.name), `duplicate schema field ${field.name}`); names.add(field.name);
      position(field.line, field.column);
      out.u32(intern(field.name)); out.u32(intern(field.file)); out.u32(field.line); out.u32(field.column);
      type(field.type, object, 0);
    }
  });
  const indegree = objects.map(() => 0);
  for (const edges of graph) for (const target of edges) indegree[target]!++;
  const pending = indegree.flatMap((degree, i) => degree === 0 ? [i] : []); let visited = 0;
  while (pending.length) {
    const object = pending.pop()!; visited++;
    for (const target of graph[object]!) if (--indegree[target]! === 0) pending.push(target);
  }
  assertEmit(visited === objects.length, 'schema object reference cycle');
  return out.finish();
}

/** Validate every emitted operand before a module can be returned to the build. */
export function validateBytecode(code: Uint8Array, strings: number, slots: ReadonlySet<number>, islands: ReadonlyMap<number, number>): Map<number, number> {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const starts = new Map<number, number>();
  const str = (id: number): void => assertEmit(id < strings, `string index ${id} is out of bounds`);
  const slot = (id: number): void => assertEmit(slots.has(id), `undeclared slot ${id}`);
  function region(start: number, end: number, depth: number): void {
    assertEmit(depth <= C.MAX_CONTROL_DEPTH, 'control-flow depth exceeds 64');
    let pos = start;
    const need = (n: number): void => assertEmit(n <= end - pos, `bytecode operand/region truncated at ${pos}`);
    const u16 = (): number => { need(2); const n = view.getUint16(pos, true); pos += 2; return n; };
    const u32 = (): number => { need(4); const n = view.getUint32(pos, true); pos += 4; return n; };
    while (pos < end) {
      const at = pos, op = code[pos++]!; starts.set(at, op);
      switch (op) {
        case C.OP_OPEN_TAG: case C.OP_VOID_TAG: {
          str(u32()); const count = u16(); need(count * 8);
          for (let i = 0; i < count; i++) { str(u32()); str(u32()); } break;
        }
        case C.OP_CLOSE_TAG: case C.OP_TEXT: str(u32()); break;
        case C.OP_DYN_TEXT: slot(u16()); u16(); break;
        case C.OP_DYN_ATTR: str(u32()); slot(u16()); break;
        case C.OP_PROP: slot(u16()); str(u32()); slot(u16()); break;
        case C.OP_COALESCE: slot(u16()); slot(u16()); slot(u16()); break;
        case C.OP_ISLAND_START: { const id = u16(); assertEmit(islands.has(id), `undeclared island ${id}`); break; }
        case C.OP_ISLAND_END: u16(); break;
        case C.OP_SHOW_ELSE: break; // Retained v2 no-op; the AST writer emits only separators.
        case C.OP_SHOW_IF: {
          slot(u16()); const thenLength = u32(), elseLength = u32(); need(thenLength + 1 + elseLength);
          const thenEnd = pos + thenLength;
          assertEmit(code[thenEnd] === C.OP_SHOW_ELSE, 'SHOW_IF has no SHOW_ELSE separator');
          region(pos, thenEnd, depth + 1); starts.set(thenEnd, C.OP_SHOW_ELSE);
          region(thenEnd + 1, thenEnd + 1 + elseLength, depth + 1); pos = thenEnd + 1 + elseLength; break;
        }
        case C.OP_LIST: {
          slot(u16()); slot(u16()); const length = u32(); need(length);
          region(pos, pos + length, depth + 1); pos += length; break;
        }
        default: throw emissionError(`invalid or reserved opcode 0x${op.toString(16)} at ${at}`);
      }
    }
  }
  region(0, code.length, 0);
  for (const [id, offset] of islands) {
    assertEmit(starts.get(offset) === C.OP_ISLAND_START && view.getUint16(offset + 1, true) === id, `island ${id} offset must point at its ISLAND_START`);
  }
  return starts;
}

export function encodeKeyPaths(paths: readonly KeyPath[], starts: ReadonlyMap<number, number>, intern: (s: string) => number): Uint8Array {
  const out = new PayloadWriter(); out.u32(paths.length);
  const sorted = [...paths].sort((a, b) => a.listOffset - b.listOffset); let previous = -1;
  for (const path of sorted) {
    assertEmit(path.listOffset > previous && starts.get(path.listOffset) === C.OP_LIST, 'key paths must name unique LIST opcode boundaries'); previous = path.listOffset;
    assertEmit(path.segments.length >= 1 && path.segments.length <= C.MAX_KEY_SEGMENTS, 'key paths need 1..32 segments');
    out.u32(path.listOffset); out.u8(path.segments.length);
    for (const segment of path.segments) out.u32(intern(segment));
  }
  return out.finish();
}
export function encodeSourcePositions(positions: readonly SourcePosition[], starts: ReadonlyMap<number, number>, intern: (s: string) => number): Uint8Array {
  const out = new PayloadWriter(); out.u32(positions.length);
  const sorted = [...positions].sort((a, b) => a.opcodeOffset - b.opcodeOffset); let previous = -1;
  const allowed: readonly number[] = [C.OP_OPEN_TAG, C.OP_VOID_TAG, C.OP_ISLAND_START, C.OP_SHOW_IF, C.OP_LIST];
  for (const entry of sorted) {
    assertEmit(entry.opcodeOffset > previous && allowed.includes(starts.get(entry.opcodeOffset) ?? -1), 'source position must name a unique eligible opcode boundary'); previous = entry.opcodeOffset;
    position(entry.line, entry.column);
    out.u32(entry.opcodeOffset); out.u32(intern(entry.file)); out.u32(entry.line); out.u32(entry.column); out.u32(intern(entry.component));
  }
  return out.finish();
}
