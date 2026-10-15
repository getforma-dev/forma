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
  assertEmit, uint, encodePropsSchema, encodeKeyPaths, encodeSourcePositions, validateBytecode,
  type PropsSchema, type KeyPath, type SourcePosition,
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

  private propsSchema: PropsSchema = [[]];
  private keyPaths: KeyPath[] = [];
  private sourcePositions: SourcePosition[] | undefined;

  /** Declared page object zero and its nested object types. */
  setPropsSchema(schema: PropsSchema): void { this.propsSchema = schema; }
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
   * A declared-but-unread slot must not enter an island's `slot_ids`, or the
   * walker serializes it into `data-forma-props` and every island ships state
   * nothing on the page renders.
   * Verified by: packages/compiler/tests/island-registry.test.ts > "island slot ids include the signal slots its own scope minted"
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

  /** Matches per-item list scratch slots (`list:<base>:item`). These are
   *  TYPE_OBJECT working storage the LIST opcode overwrites per row, so after
   *  SSR they hold the LAST rendered row — serializing them into an island's
   *  data-forma-props would leak that row into the page. They are excluded
   *  from island slot ids; everything else (attr:*, text:*, show:*,
   *  list:*:array, list:*:<prop>, named signal slots) is kept. */
  private static readonly LIST_ITEM_SCRATCH_RE = /^list:[^:]+:item$/;

  /** Replace the slot ids of a registered island entry (back-filled after
   *  the island's component subtree has been walked). Filters out per-item
   *  list scratch slots — see LIST_ITEM_SCRATCH_RE. */
  setIslandSlotIds(islandId: number, slotIds: number[]): void {
    const island = this.islands.find(i => i.id === islandId);
    if (!island) return;
    island.slotIds = slotIds.filter(id => {
      const slot = this.slots.find(s => s.id === id);
      return !slot || !IrEmitContext.LIST_ITEM_SCRATCH_RE.test(slot.name);
    });
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
    const islands = this.encodeIslandTable();
    const bytecode = new Uint8Array(this.opcodes);
    const starts = validateBytecode(bytecode, this.strings.length,
      new Set(this.slots.map(s => s.id)), new Map(this.islands.map(i => [i.id, i.byteOffset])));
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
    return encodeFmirSections(sections);
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
  getIslands(): Array<{ id: number; name: string; trigger: number; slotIds: number[] }> {
    return this.islands.map(i => ({
      id: i.id,
      name: this.strings[i.nameStrIdx] || `island_${i.id}`,
      trigger: i.trigger,
      slotIds: i.slotIds,
    }));
  }

  /** Length-prefixed v3 islands. Digest emission is reserved for FORMA-105. */
  private encodeIslandTable(): Uint8Array {
    const declaredSlots = new Set(this.slots.map(slot => slot.id));
    let totalSize = 2;
    for (const island of this.islands) {
      assertEmit(Number.isInteger(island.trigger) && island.trigger >= C.TRIGGER_LOAD && island.trigger <= C.TRIGGER_IDLE, 'invalid island trigger');
      uint(island.schemaObject, 0xffff, 'island schema object');
      assertEmit(island.schemaObject === 0xffff || island.schemaObject < this.propsSchema.length, 'island schema object out of bounds');
      uint(island.byteOffset, 0xffffffff, 'island byte offset');
      const length = 17 + island.slotIds.length * 2;
      assertEmit(length <= 0xffff, 'island entry exceeds u16 length (at most 32759 slot ids)');
      for (const id of island.slotIds) assertEmit(declaredSlots.has(id), `island references undeclared slot ${id}`);
      totalSize += 2 + length;
    }
    assertEmit(totalSize <= C.MAX_MODULE_SIZE, 'island section exceeds module size ceiling');
    const buf = new Uint8Array(totalSize), view = new DataView(buf.buffer);
    view.setUint16(0, this.islands.length, true);
    let pos = 2;
    for (const island of this.islands) {
      view.setUint16(pos, 17 + island.slotIds.length * 2, true); pos += 2;
      view.setUint16(pos, island.id, true); pos += 2;
      buf[pos++] = island.trigger; buf[pos++] = 0;
      view.setUint32(pos, island.nameStrIdx, true); pos += 4;
      view.setUint32(pos, island.byteOffset, true); pos += 4;
      view.setUint16(pos, island.schemaObject, true); pos += 2;
      buf[pos++] = 0; // digest_len; FORMA-105 owns the content and validation.
      view.setUint16(pos, island.slotIds.length, true); pos += 2;
      for (const slot of island.slotIds) { view.setUint16(pos, slot, true); pos += 2; }
    }
    return buf;
  }
}
