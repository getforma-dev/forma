/**
 * Forma Compiler - FMIR Binary Buffer
 *
 * IrEmitContext accumulates FMIR v3 bytecode, strings, slots, islands,
 * props schema and optional key paths/source positions — and serializes them into the binary format the
 * Rust-side walker reads to produce HTML.
 *
 * It is a buffer, not a compiler: the AST → opcode translation lives entirely
 * in ir-walk.ts (walkHTree / walkCallExpression), which is what the SSR plugin
 * drives. Only Static and Dynamic subtrees reach the bytecode — Island
 * subtrees stay as client-side JS behind ISLAND_START/ISLAND_END markers.
 */

import * as C from './fmir-constants.js';
import { encodeFmirSections, dumpFmir, type FmirSection } from './fmir.js';
import {
  encodeClosedConstant, encodeIslandContracts, makeIslandContract,
  type BindingRecord, type CanonicalSchema, type IslandContract, type IslandRenderMode,
} from './fmir-contracts.js';
import {
  assertEmit, uint, encodePropsSchema, encodeKeyPaths, encodeSourcePositions, validateBytecode,
  type PropsSchema, type KeyPath, type SourcePosition, type SchemaType,
} from './fmir-payload.js';
export {
  SLOT_TYPE_TEXT, SLOT_TYPE_BOOL, SLOT_TYPE_NUMBER, SLOT_TYPE_ARRAY, SLOT_TYPE_OBJECT,
  SLOT_SOURCE_SERVER, SLOT_SOURCE_CLIENT,
} from './fmir-constants.js';
export type { PropsSchema, SchemaField, SchemaType, KeyPath, SourcePosition } from './fmir-payload.js';

/**
 * The error the encoder throws for an entry past FMIR's u16 length prefix: the
 * message as before, with the diagnostic code a build reports it under
 * (BUILD-604), so the SSR plugin need not match the text.
 */
function literalTooLong(message: string): Error {
  return Object.assign(new Error(message), { code: 'BUILD-604' });
}

// ---------------------------------------------------------------------------
// IrEmitContext
// ---------------------------------------------------------------------------

export class IrEmitContext {
  /** String interning map: string -> index */
  private stringMap: Map<string, number> = new Map();
  /** Interned strings in order */
  private strings: string[] = [];

  /** Slot tracking */
  private slots: Array<{ id: number; name: string; typeHint: number; source: number; defaultBytes: Uint8Array }> = [];
  private nextSlotId: number = 0;

  /** Opcode buffer */
  private opcodes: number[] = [];

  /** Island tracking */
  private islands: Array<{
    id: number;
    trigger: number;
    schemaObject: number;
    nameStrIdx: number;
    slotIds: number[];
    byteOffset: number;
  }> = [];

  private propsSchema: Array<PropsSchema[number]> = [[]];
  private readonly islandBindings = new Map<number, { mode: IslandRenderMode; bindings: readonly BindingRecord[] }>();
  private readonly constants = new Map<number, unknown>();
  private readonly closedProjections = new Map<number, unknown>();
  private keyPaths: KeyPath[] = [];
  private sourcePositions: SourcePosition[] | undefined;

  /** Declared page object zero and its nested object types. */
  setPropsSchema(schema: PropsSchema): void { this.propsSchema = [...schema]; }
  getPropsSchema(): PropsSchema { return this.propsSchema; }
  /** Append a declared component schema without changing the page's root object. */
  appendPropsSchema(schema: PropsSchema): number {
    const offset = this.propsSchema.length;
    assertEmit(schema.length > 0 && offset + schema.length <= C.MAX_SCHEMA_ITEMS, 'combined schema exceeds 1024 objects');
    const type = (value: SchemaType): SchemaType => value.kind === 'object' ? { ...value, object: value.object + offset }
      : value.kind === 'array' ? { ...value, element: type(value.element) }
        : value.kind === 'optional' ? { ...value, inner: type(value.inner) } : value;
    this.propsSchema.push(...schema.map(fields => fields.map(field => ({ ...field, type: type(field.type) }))));
    return offset;
  }
  /** Metadata belongs to one declared component, while input slots belong to its call. */
  setIslandContract(islandId: number, mode: IslandRenderMode, bindings: readonly BindingRecord[]): void {
    assertEmit(this.islands.some(island => island.id === islandId), `unknown island ${islandId}`);
    this.islandBindings.set(islandId, { mode, bindings });
  }
  private contracts(): IslandContract[] {
    return this.islands.map(island => {
      const contract = this.islandBindings.get(island.id);
      assertEmit(contract, `island ${island.id} has no declared contract`);
      assertEmit(island.schemaObject < this.propsSchema.length, 'island contract has no declared schema object');
      assertEmit(island.slotIds.length === this.propsSchema[island.schemaObject]!.length, 'island input count must equal its declared field count');
      return makeIslandContract(island.id, this.propsSchema, island.schemaObject, contract.mode, contract.bindings);
    });
  }
  /** FORMA-181 may attach a path without changing LIST operands. */
  addKeyPath(listOffset: number, segments: readonly string[]): void { this.keyPaths.push({ listOffset, segments: [...segments] }); }
  /** Optional diagnostics, using 1-based UTF-16 columns. */
  setSourcePositions(positions: readonly SourcePosition[]): void { this.sourcePositions = [...positions]; }
  setIslandSchemaObject(islandId: number, schemaObject: number): void {
    const island = this.islands.find(i => i.id === islandId);
    assertEmit(island, `unknown island ${islandId}`); island.schemaObject = schemaObject;
  }
  /** Lossless canonical diagnostic dump, shared with forma-ir. */
  dump(): string { return dumpFmir(this.toBinary()); }

  /** Stack of slot-id capture sets for island subtree walks.
   *  Every set on the stack records each referenced slot, so an outer
   *  island's span also captures slots of islands nested inside it. */
  private slotCaptureStack: Set<number>[] = [];

  /** DYN_TEXT marker counter */
  private nextMarkerId: number = 0;

  /** Island ID counter */
  private nextIslandCounter: number = 0;

  /** Intern a string, return its index. Deduplicates. */
  addString(s: string): number {
    const existing = this.stringMap.get(s);
    if (existing !== undefined) return existing;
    assertEmit(this.strings.length < C.MAX_STRINGS, 'string count exceeds 1048576');
    const idx = this.strings.length;
    this.strings.push(s);
    this.stringMap.set(s, idx);
    return idx;
  }

  /**
   * Register a new slot, return its id.
   *
   * `reference` says whether creating the slot also counts as USING it inside
   * the island subtree currently being captured. It is true for every slot
   * minted because an opcode needs one, and false for a slot merely DECLARED —
   * a signal the walk found in scope but that no binding on the page reads.
   * Capture bookkeeping supports the bytecode walk only. Island input lists
   * are independently constructed from ordered declared fields; local signals
   * and captured defaults never enter the state envelope as handler props.
   * Verified by: packages/compiler/tests/island-registry.test.ts > "local signal defaults and list scratch values stay outside declared inputs"
   */
  addSlot(
    name: string,
    typeHint: number,
    source: number = C.SLOT_SOURCE_CLIENT,
    defaultBytes: Uint8Array = new Uint8Array(0),
    reference: boolean = true,
  ): number {
    assertEmit(this.slots.length < C.MAX_SLOTS, 'slot count exceeds 65535');
    const id = this.nextSlotId++;
    // A client debug label must never collide with an exact declared root name.
    // Only SERVER+schema-name carries a handler binding; client labels do not.
    if (source === C.SLOT_SOURCE_CLIENT && this.propsSchema[0]!.some(field => field.name === name)) {
      name = `$slot${id}`;
      while (this.slots.some(slot => slot.name === name) || this.propsSchema[0]!.some(field => field.name === name)) name = `_${name}`;
    }
    this.slots.push({ id, name, typeHint, source, defaultBytes });
    if (reference) this.recordSlotRef(id);
    return id;
  }

  /** A private projection/list scratch slot. Its label has no binding semantics. */
  addTemporarySlot(typeHint: number): number {
    let name = `$slot${this.nextSlotId}`;
    while (this.slots.some(slot => slot.name === name) || this.propsSchema[0]!.some(field => field.name === name)) name = `_${name}`;
    return this.addSlot(name, typeHint, C.SLOT_SOURCE_CLIENT);
  }

  /** Explicit closed constants distinguish empty text from an absent legacy default. */
  addConstantSlot(value: unknown, typeHint: number): number {
    encodeClosedConstant(value);
    const id = this.addTemporarySlot(typeHint);
    this.constants.set(id, value);
    return id;
  }

  /** Closed provenance is distinct from a schema hint, including literal null. */
  constantSlot(id: number): { value: unknown } | undefined {
    return this.constants.has(id) ? { value: this.constants.get(id) } : this.closedProjections.has(id) ? {value:this.closedProjections.get(id)} : undefined;
  }

  /** Compiler-known PROP result; still independently validated by native flow. */
  recordClosedProjection(source:number,key:string,target:number):void {
    const closed=this.constantSlot(source);if(!closed)return;
    const value=closed.value;
    if(value===null)this.closedProjections.set(target,null);
    else if(typeof value==='object'&&!Array.isArray(value))this.closedProjections.set(target,Object.hasOwn(value,key)?(value as Record<string,unknown>)[key]:null);
  }

  /** Begin capturing slot ids referenced while walking an island subtree. */
  beginSlotCapture(): void {
    this.slotCaptureStack.push(new Set<number>());
  }

  /** End the innermost capture; returns the captured slot ids sorted ascending. */
  endSlotCapture(): number[] {
    const captured = this.slotCaptureStack.pop();
    return captured ? Array.from(captured).sort((a, b) => a - b) : [];
  }

  /** Record a slot-id reference into every active capture set.
   *  Called by addSlot for slots minted because an opcode needs them; call it
   *  directly when an opcode reuses a pre-existing slot (an in-scope signal, a
   *  list item binding) without addSlot. */
  recordSlotRef(id: number): void {
    for (const set of this.slotCaptureStack) set.add(id);
  }

  /** Ordered declared inputs may repeat a slot, including a current LIST row.
   * The native walker snapshots them at ISLAND_START before the row advances. */
  setIslandSlotIds(islandId: number, slotIds: number[]): void {
    const island = this.islands.find(i => i.id === islandId);
    if (!island) return;
    island.slotIds = [...slotIds];
  }

  /** Get a fresh marker id for DYN_TEXT. */
  nextMarker(): number {
    uint(this.nextMarkerId, 0xffff, 'DYN_TEXT marker id');
    return this.nextMarkerId++;
  }

  /** Peek at the next island id without incrementing the counter. */
  peekNextIslandId(): number {
    return this.nextIslandCounter;
  }

  /** Register a new island entry. */
  addIsland(name: string, trigger: number, slotIds: number[], byteOffset: number, schemaObject: number = 0xffff): number {
    assertEmit(this.islands.length < C.MAX_ISLANDS, 'island count exceeds 4096');
    const id = this.nextIslandCounter++;
    const nameStrIdx = this.addString(name);
    this.islands.push({ id, trigger, schemaObject, nameStrIdx, slotIds: [...slotIds], byteOffset });
    return id;
  }

  /** Emit a raw byte. */
  emit(byte: number): void {
    uint(byte, 255, 'byte');
    this.opcodes.push(byte);
  }

  /** Emit u16 little-endian. */
  emitU16(val: number): void {
    uint(val, 0xffff, 'u16 operand');
    this.opcodes.push(val & 0xff);
    this.opcodes.push((val >>> 8) & 0xff);
  }

  /** Emit u32 little-endian. */
  emitU32(val: number): void {
    uint(val, 0xffffffff, 'u32 operand');
    this.opcodes.push(val & 0xff);
    this.opcodes.push((val >>> 8) & 0xff);
    this.opcodes.push((val >>> 16) & 0xff);
    this.opcodes.push((val >>> 24) & 0xff);
  }

  /** Get current opcode buffer length (for offset calculations). */
  opcodeLen(): number {
    return this.opcodes.length;
  }

  /** Patch a u32 at a previous position (for back-patching body lengths). */
  patchU32(pos: number, val: number): void {
    uint(pos, Math.max(0, this.opcodes.length - 4), 'patch offset');
    assertEmit(pos + 4 <= this.opcodes.length, 'patch exceeds bytecode');
    uint(val, 0xffffffff, 'u32 operand');
    this.opcodes[pos] = val & 0xff;
    this.opcodes[pos + 1] = (val >>> 8) & 0xff;
    this.opcodes[pos + 2] = (val >>> 16) & 0xff;
    this.opcodes[pos + 3] = (val >>> 24) & 0xff;
  }

  /** Build the complete canonical FMIR v3 binary. */
  toBinary(): Uint8Array {
    const slotTable = this.encodeSlotTable(); // Intern slot names before strings.
    const schema = encodePropsSchema(this.propsSchema, s => this.addString(s));
    const contracts = this.contracts();
    const islands = this.encodeIslandTable(contracts);
    const bytecode = new Uint8Array(this.opcodes);
    const starts = validateBytecode(bytecode, this.strings.length,
      new Set(this.slots.map(s => s.id)), new Map(this.islands.map(i => [i.id, i.byteOffset])));
    this.validateConstants(bytecode, starts);
    const keys = this.keyPaths.length ? encodeKeyPaths(this.keyPaths, starts, s => this.addString(s)) : undefined;
    const positions = this.sourcePositions === undefined ? undefined
      : encodeSourcePositions(this.sourcePositions, starts, s => this.addString(s));
    const sections: FmirSection[] = [
      { id: C.SECTION_BYTECODE, flags: C.SECTION_REQUIRED, bytes: bytecode },
      { id: C.SECTION_STRINGS, flags: C.SECTION_REQUIRED, bytes: this.encodeStringTable() },
      { id: C.SECTION_SLOTS, flags: C.SECTION_REQUIRED, bytes: slotTable },
      { id: C.SECTION_ISLANDS, flags: C.SECTION_REQUIRED, bytes: islands },
      { id: C.SECTION_PROPS_SCHEMA, flags: C.SECTION_REQUIRED, bytes: schema },
    ];
    if (keys) sections.push({ id: C.SECTION_KEY_PATHS, flags: C.SECTION_REQUIRED, bytes: keys });
    if (positions) sections.push({ id: C.SECTION_SOURCE_POSITIONS, flags: 0, bytes: positions });
    sections.push({ id: C.SECTION_ISLAND_CONTRACTS, flags: C.SECTION_REQUIRED, bytes: encodeIslandContracts(contracts, this.constants) });
    return encodeFmirSections(sections);
  }

  private validateConstants(bytecode: Uint8Array, starts: ReadonlyMap<number, number>): void {
    const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
    const used = new Set(this.islands.flatMap(island => island.slotIds));
    const definitions = new Map<number, number>(), coalesced = new Set<number>();
    const read = (id: number): void => { used.add(id); };
    const define = (id: number): void => {
      assertEmit(!this.constants.has(id), `constant slot ${id} cannot be a destination`);
      definitions.set(id, (definitions.get(id) ?? 0) + 1);
    };
    for (const [at, op] of starts) {
      const u16 = (offset: number): number => view.getUint16(at + offset, true);
      switch (op) {
        case C.OP_DYN_TEXT: case C.OP_SHOW_IF: read(u16(1)); break;
        case C.OP_DYN_ATTR: read(u16(5)); break;
        case C.OP_PROP: read(u16(1)); define(u16(7)); break;
        case C.OP_LIST: read(u16(1)); define(u16(3)); break;
        case C.OP_COALESCE: {
          const source = u16(1), fallback = u16(3), destination = u16(5);
          assertEmit(source !== destination && fallback !== destination, 'COALESCE destination must differ from both inputs');
          assertEmit(this.constants.has(fallback), 'COALESCE fallback must be an explicit closed constant');
          const target = this.slots.find(slot => slot.id === destination)!;
          assertEmit(target.source === C.SLOT_SOURCE_CLIENT && target.defaultBytes.length === 0, 'COALESCE destination must be CLIENT without a default');
          read(source); read(fallback); define(destination); coalesced.add(destination); break;
        }
      }
    }
    for (const id of coalesced) assertEmit(definitions.get(id) === 1, 'COALESCE destination must have one static definition');
    for (const id of this.constants.keys()) {
      const slot = this.slots.find(slot => slot.id === id)!;
      assertEmit(slot.source === C.SLOT_SOURCE_CLIENT && slot.defaultBytes.length === 0, 'constant slot must be CLIENT without a legacy default');
      assertEmit(used.has(id), `unreferenced constant slot ${id}`);
    }
  }

  /** Encode the string table section. */
  private encodeStringTable(): Uint8Array {
    const encoder = new TextEncoder();

    // Calculate total size: 4 (count) + sum of (2 + len) per string
    let totalSize = 4; // count u32
    const encodedStrings: Uint8Array[] = [];
    for (const s of this.strings) {
      const encoded = encoder.encode(s);
      // The per-string length prefix is a u16 — a longer string would
      // silently wrap via setUint16 and desynchronize the whole table for
      // the Rust parser. Fail hard instead of emitting a corrupt binary
      // The caller receives BUILD-604; it must not truncate the prefix.
      if (encoded.length > 0xffff) {
        throw literalTooLong(
          `FMIR string table entry is ${encoded.length} UTF-8 bytes — exceeds the 65535-byte u16 length limit (string starts with ${JSON.stringify(s.slice(0, 40))}...)`,
        );
      }
      encodedStrings.push(encoded);
      totalSize += 2 + encoded.length; // u16 len + bytes
    }

    assertEmit(totalSize <= C.MAX_MODULE_SIZE, 'section exceeds module size ceiling');
    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);

    // Count (u32 LE)
    view.setUint32(0, this.strings.length, true);

    let pos = 4;
    for (const encoded of encodedStrings) {
      // Length (u16 LE)
      view.setUint16(pos, encoded.length, true);
      pos += 2;
      // UTF-8 bytes
      buf.set(encoded, pos);
      pos += encoded.length;
    }

    return buf;
  }

  /** Encode the slot table section (v2 format). */
  private encodeSlotTable(): Uint8Array {
    // v2: count(u16) + variable-length entries
    // Each entry: slot_id(u16) + name_str_idx(u32) + type_hint(u8) + source(u8) + default_len(u16) + default_bytes
    let totalSize = 2; // count
    for (const slot of this.slots) {
      assertEmit(slot.typeHint >= C.SLOT_TYPE_TEXT && slot.typeHint <= C.SLOT_TYPE_OBJECT && Number.isInteger(slot.typeHint), `invalid slot type ${slot.typeHint}`);
      assertEmit(slot.source === C.SLOT_SOURCE_SERVER || slot.source === C.SLOT_SOURCE_CLIENT, `invalid slot source ${slot.source}`);
      if (slot.defaultBytes.length) {
        let value: string;
        try { value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(slot.defaultBytes); }
        catch { throw Object.assign(new Error(`FMIR: slot '${slot.name}' default is not UTF-8`), { code: 'BUILD-606' }); }
        const valid = slot.typeHint === C.SLOT_TYPE_TEXT
          || (slot.typeHint === C.SLOT_TYPE_BOOL && (value === 'true' || value === 'false'))
          || (slot.typeHint === C.SLOT_TYPE_NUMBER && /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value) && Number.isFinite(Number(value)))
          || (slot.typeHint === C.SLOT_TYPE_ARRAY && value === '[]');
        assertEmit(valid, `slot '${slot.name}' default does not parse for type ${slot.typeHint}`);
      }
      // default_len is a u16 — larger defaults would silently wrap and
      // corrupt the slot table (see the matching guard in encodeStringTable).
      if (slot.defaultBytes.length > 0xffff) {
        throw literalTooLong(
          `FMIR slot '${slot.name}' has a ${slot.defaultBytes.length}-byte default — exceeds the 65535-byte u16 length limit`,
        );
      }
      totalSize += 2 + 4 + 1 + 1 + 2 + slot.defaultBytes.length; // 10 + default_bytes.length
    }

    assertEmit(totalSize <= C.MAX_MODULE_SIZE, 'section exceeds module size ceiling');
    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);
    view.setUint16(0, this.slots.length, true);

    let pos = 2;
    for (const slot of this.slots) {
      view.setUint16(pos, slot.id, true); pos += 2;
      const nameIdx = this.addString(slot.name);
      view.setUint32(pos, nameIdx, true); pos += 4;
      buf[pos] = slot.typeHint; pos += 1;
      buf[pos] = slot.source; pos += 1;
      view.setUint16(pos, slot.defaultBytes.length, true); pos += 2;
      buf.set(slot.defaultBytes, pos);
      pos += slot.defaultBytes.length;
    }

    return buf;
  }

  /** Get registered island entries (for build.ts to generate client registry). */
  getIslands(): Array<{ id: number; name: string; trigger: number; slotIds: number[]; contract?: { mode: IslandRenderMode; digest: string; schema: CanonicalSchema } }> {
    const contracts = new Map(this.contracts().map(contract => [contract.islandId, contract]));
    return this.islands.map(i => ({
      id: i.id,
      name: this.strings[i.nameStrIdx] || `island_${i.id}`,
      trigger: i.trigger,
      slotIds: i.slotIds,
      contract: { mode: contracts.get(i.id)!.mode, digest: Buffer.from(contracts.get(i.id)!.digest).toString('hex'), schema: contracts.get(i.id)!.schema },
    }));
  }

  /** Declared ordered inputs and the paired browser/native binding identity. */
  private encodeIslandTable(contracts: readonly IslandContract[]): Uint8Array {
    const declaredSlots = new Set(this.slots.map(slot => slot.id));
    let totalSize = 2;
    for (const island of this.islands) {
      assertEmit(Number.isInteger(island.trigger) && island.trigger >= C.TRIGGER_LOAD && island.trigger <= C.TRIGGER_IDLE, 'invalid island trigger');
      uint(island.schemaObject, 0xffff, 'island schema object');
      assertEmit(island.schemaObject === 0xffff || island.schemaObject < this.propsSchema.length, 'island schema object out of bounds');
      uint(island.byteOffset, 0xffffffff, 'island byte offset');
      const length = 25 + island.slotIds.length * 2;
      assertEmit(length <= 0xffff, 'island entry exceeds u16 length (at most 32755 slot ids)');
      for (const id of island.slotIds) assertEmit(declaredSlots.has(id), `island references undeclared slot ${id}`);
      totalSize += 2 + length;
    }
    assertEmit(totalSize <= C.MAX_MODULE_SIZE, 'island section exceeds module size ceiling');
    const buf = new Uint8Array(totalSize), view = new DataView(buf.buffer);
    view.setUint16(0, this.islands.length, true);
    let pos = 2;
    for (const [index, island] of this.islands.entries()) {
      view.setUint16(pos, 25 + island.slotIds.length * 2, true); pos += 2;
      view.setUint16(pos, island.id, true); pos += 2;
      buf[pos++] = island.trigger; buf[pos++] = 0;
      view.setUint32(pos, island.nameStrIdx, true); pos += 4;
      view.setUint32(pos, island.byteOffset, true); pos += 4;
      view.setUint16(pos, island.schemaObject, true); pos += 2;
      buf[pos++] = 8;
      buf.set(contracts[index]!.digest, pos); pos += 8;
      view.setUint16(pos, island.slotIds.length, true); pos += 2;
      for (const slot of island.slotIds) { view.setUint16(pos, slot, true); pos += 2; }
    }
    return buf;
  }
}
