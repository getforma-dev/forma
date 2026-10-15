import { SIGNATURE } from '../src/fmir-constants';
import { COMPILER_WRITER_VERSION, readFmirContainer } from '../src/fmir';
/**
 * IR Roundtrip Validation Tests
 *
 * These tests validate the structural integrity of FMIR binaries produced by
 * the TypeScript emitter. They complement the Rust-side walker roundtrip tests
 * (walker.rs::roundtrip_*) which verify that programmatically-built IR walks
 * to correct HTML.
 *
 * These local structural controls complement the real native-emitter corpus
 * and the writer/native/browser state transport controls. They do not claim
 * to replace strict native payload validation.
 *
 * The end-to-end case compiles a page fixture committed in this repository
 * (tests/fixtures/ssr-page) through the real generateRealIr() pipeline, so it
 * always runs. It replaces two earlier tests that read .ir files from a build
 * directory outside the repository: those resolved to a path that exists on no
 * machine here, so they returned early and reported green while asserting
 * nothing at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { IrEmitContext } from '../src/ir-emit';
import { generateRealIr, generatePlaceholderIr } from '../src/esbuild-ssr-plugin';
import {
  assertBinaryInvariants,
  getIslands,
  getSlots,
  getStrings,
  parseOpcodeList,
  readSections,
  readStringTable,
  readU16LE,
  readU32LE,
} from './helpers/fmir';

const FIXTURE_ENTRY = resolve(__dirname, 'fixtures/ssr-page/app.ts');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IR roundtrip validation', () => {
  it('emitted IR has valid section bounds', () => {
    // Build a simple IR via IrEmitContext, verify all section offsets + sizes
    // are within file bounds.
    const ctx = new IrEmitContext();
    const divIdx = ctx.addString('div');
    ctx.emit(0x01); // OPEN_TAG
    ctx.emitU32(divIdx);
    ctx.emitU16(0); // 0 attrs
    ctx.emit(0x02); // CLOSE_TAG
    ctx.emitU32(divIdx);
    const binary = ctx.toBinary();

    const s = readSections(binary);

    const sections = readFmirContainer(binary).sections;
    expect(sections.map(section => section.id)).toEqual([1, 2, 3, 4, 5, 10]);
    // Header (24), table prefix (4), and six 12-byte descriptors.
    let offset = 24 + 4 + 6 * 12;
    for (const section of sections) {
      expect(section.offset).toBe(offset);
      expect(section.offset + section.length).toBeLessThanOrEqual(binary.length);
      offset += section.length;
    }
    expect(offset).toBe(binary.length);
    expect(s.schemaOffset).toBe(s.islandTableOffset + s.islandTableSize);
    expect(sections.at(-1)!.offset).toBe(s.schemaOffset + s.schemaSize);
  });

  it('string table is readable and contains exactly the interned entries', () => {
    const ctx = new IrEmitContext();
    ctx.addString('hello');
    ctx.addString('world');
    // Need at least one opcode for a valid file
    ctx.emit(0x04); // TEXT
    ctx.emitU32(0);
    const binary = ctx.toBinary();

    expect(getStrings(binary)).toEqual(['hello', 'world']);
  });

  it('opcode stream round-trips a div with text through the section table', () => {
    const ctx = new IrEmitContext();
    const divIdx = ctx.addString('div');
    const textIdx = ctx.addString('Hello');

    ctx.emit(0x01); // OPEN_TAG
    ctx.emitU32(divIdx);
    ctx.emitU16(0);
    ctx.emit(0x04); // TEXT
    ctx.emitU32(textIdx);
    ctx.emit(0x02); // CLOSE_TAG
    ctx.emitU32(divIdx);

    const binary = ctx.toBinary();

    expect(parseOpcodeList(binary)).toEqual([
      'OPEN_TAG div',
      'TEXT "Hello"',
      'CLOSE_TAG div',
    ]);
  });

  // -------------------------------------------------------------------------
  // End to end: an in-repo page fixture through the real SSR pipeline
  // -------------------------------------------------------------------------

  describe('page fixture compiled through generateRealIr', () => {
    /** Compile the committed fixture page, muting the emitter's build warnings. */
    function compileFixture() {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const result = generateRealIr(FIXTURE_ENTRY);
        expect(result, 'fixture page must compile to real IR, not fall back').not.toBeNull();
        expect(warnSpy, 'declared fixture has no unresolved source reads').not.toHaveBeenCalled();
        return result!;
      } finally {
        warnSpy.mockRestore();
      }
    }

    it('produces a valid FMIR v3 header and non-trivial content', () => {
      const { binary } = compileFixture();
      const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);

      expect(Array.from(binary.slice(0, 8))).toEqual(Array.from(SIGNATURE));
      expect(readFmirContainer(binary).writer).toEqual(COMPILER_WRITER_VERSION);
      expect(view.getUint16(22, true)).toBe(0); // reserved
      // Real content, not a ~136-byte placeholder.
      expect(binary.length).toBeGreaterThan(200);
    });

    it('every section is in bounds and the bytecode decodes exactly', () => {
      const { binary } = compileFixture();
      const s = readSections(binary);

      for (const [name, offset, size] of [
        ['Bytecode', s.opcodeOffset, s.opcodeSize],
        ['Strings', s.stringTableOffset, s.stringTableSize],
        ['Slots', s.slotTableOffset, s.slotTableSize],
        ['Islands', s.islandTableOffset, s.islandTableSize],
      ] as Array<[string, number, number]>) {
        expect(offset, `${name} section start`).toBeGreaterThanOrEqual(100);
        expect(offset + size, `${name} section end`).toBeLessThanOrEqual(binary.length);
      }

      // parseOpcodeList throws on an unknown opcode, a mid-instruction section
      // end, or a SHOW_IF/LIST length that does not bound whole instructions.
      const ops = parseOpcodeList(binary);
      expect(ops.length).toBeGreaterThan(20);
      expect(ops.filter(o => o.startsWith('OPEN_TAG ')).length)
        .toBe(ops.filter(o => o.startsWith('CLOSE_TAG ')).length);
    });

    it('emits the page structure the source describes', () => {
      const { binary } = compileFixture();
      const ops = parseOpcodeList(binary);

      // Root element with its static and dynamic attributes.
      expect(ops[0]).toBe('OPEN_TAG section id="app"');
      expect(ops[1]).toBe('DYN_ATTR class -> attr:class');
      // The plain sub-component is inlined; the island body keeps its boundary.
      expect(ops).toContain('OPEN_TAG article class="summary"');
      expect(ops).toContain('ISLAND_START StatusPanel#0');
      expect(ops).toContain('ISLAND_END StatusPanel#0');
      // The static NAV_ITEMS spread is unrolled, not deferred to an island —
      // with each row's href substituted into the ATTRIBUTE, not just its
      // label into the child text.
      expect(ops.filter(o => /^OPEN_TAG a(\s|$)/.test(o))).toEqual([
        'OPEN_TAG a href="/"',
        'OPEN_TAG a href="/reports"',
      ]);
      expect(ops).toContain('TEXT "Home"');
      expect(ops).toContain('TEXT "Reports"');
      // List, show and event-handler elision all survive the real pipeline.
      expect(ops.filter(op => op.startsWith('LIST '))).toEqual(['LIST array=$slot11 item=$slot12 body=33']);
      expect(ops.filter(op => op.startsWith('PROP '))).toEqual(['PROP $slot12.name -> $slot14']);
      expect(ops).toContain('SHOW_IF show:busy then=17 else=17');
      expect(ops).toContain('VOID_TAG input type="search" placeholder="Filter"');
      expect(getStrings(binary)).not.toContain('onSubmit');
    });

    it('gives every colliding slot on the page a distinct name', () => {
      const { binary } = compileFixture();

      // Root, summary and row class computations each retain a separate slot;
      // the two computed metrics share a child index but never an identity.
      // Module captures use named defaults, while local aggregate/list scratch
      // values use private labels with no handler binding semantics.
      expect(getSlots(binary).map(s => s.name)).toEqual([
        'title', 'busy', 'uptime', 'latency',
        'attr:class', 'tone', 'attr:class#2',
        'statusText', 'panelClass',
        'text:0', 'text:0#2',
        '$slot11', '$slot12', 'attr:class#3', '$slot14',
        'show:busy',
      ]);

      // Three bindings that used to mint anonymous slots now reuse the named
      // signal ones instead: `() => title()`, `disabled: () => busy()` and the
      // island's `() => statusText()`.
      expect(getSlots(binary).map(s => s.name)).not.toContain('attr:disabled');
      expect(getSlots(binary).map(s => s.name)).not.toContain('text:0#3');
    });

    it('slot table entries are well-formed and resolvable', () => {
      const { binary } = compileFixture();
      const strings = getStrings(binary);
      const slots = getSlots(binary);
      const s = readSections(binary);

      expect(slots.length).toBeGreaterThan(0);
      slots.forEach((slot, i) => {
        expect(slot.id, 'slot ids are dense and ascending').toBe(i);
        expect(slot.nameIdx, `slot ${slot.name} name index`).toBeLessThan(strings.length);
        // text=1, bool=2, number=3, array=4, object=5
        expect([0x01, 0x02, 0x03, 0x04, 0x05]).toContain(slot.typeHint);
        // server=0 (declared handler roots only), client=1
        expect([0x00, 0x01]).toContain(slot.source);
      });

      // A no-props page owns local list state; no handler addresses its scratch slots.
      const byName = new Map(slots.map(slot => [slot.name, slot]));
      expect(byName.get('$slot11')).toMatchObject({ typeHint: 0x04, source: 0x01 });
      expect(byName.get('$slot12')).toMatchObject({ typeHint: 0x05, source: 0x01 });
      expect(byName.get('show:busy')).toMatchObject({ typeHint: 0x02, source: 0x01 });
      // The signal default declared in the island file reaches the slot table.
      expect(byName.get('statusText')).toMatchObject({ typeHint: 0x01, default: 'idle' });
      expect(byName.get('panelClass')).toMatchObject({ typeHint: 0x01, default: 'panel' });
      expect(byName.get('text:0')).toMatchObject({ default: '10ms' });
      expect(byName.get('text:0#2')).toMatchObject({ default: '2ms' });

      // The slot table consumed exactly its declared section size.
      let pos = s.slotTableOffset + 2;
      for (const slot of slots) {
        pos += 10 + new TextEncoder().encode(slot.default).length;
      }
      expect(pos - s.slotTableOffset).toBe(s.slotTableSize);
      expect(readU16LE(binary, s.slotTableOffset)).toBe(slots.length);
    });

    it('island metadata matches the binary island table', () => {
      const { binary, islands } = compileFixture();
      const tableIslands = getIslands(binary);

      expect(islands.map(i => i.name)).toEqual(['StatusPanel']);
      expect(tableIslands).toHaveLength(1);
      expect(tableIslands[0]).toMatchObject({
        id: 0,
        name: 'StatusPanel',
        trigger: 0x01,   // Load
        schemaObject: 1, // actual empty declared island props
      });
      // Module captures keep their identity and defaults, never handler inputs.
      expect(tableIslands[0]!.slotIds).toEqual([]);
      expect(islands[0]!.contract!.schema).toEqual([[]]);
      expect(islands[0]!.slotIds).toEqual(tableIslands[0]!.slotIds);
    });

    it('satisfies the universal FMIR invariants', () => {
      // Unique slot names and ids, an interned and orphan-free string table,
      // and island byte offsets that point at their own ISLAND_START.
      assertBinaryInvariants(compileFixture().binary);
    });
  });

  // -------------------------------------------------------------------------
  // Explicit placeholder helper — declared native refusal never uses it
  // -------------------------------------------------------------------------

  it('placeholder IR from the SSR plugin has valid structure', () => {
    // Calls the SHIPPED generatePlaceholderIr. A copy of its body inlined here
    // would keep passing even if the real fallback were gutted.
    const binary = generatePlaceholderIr('test-page');

    // Valid FMIR magic + version
    expect(Array.from(binary.slice(0, 8))).toEqual(Array.from(SIGNATURE));
    expect(readFmirContainer(binary).writer).toEqual(COMPILER_WRITER_VERSION);

    expect(getStrings(binary)).toEqual(['div', 'id', 'app', 'data-forma-page', 'test-page']);
    expect(parseOpcodeList(binary)).toEqual([
      'OPEN_TAG div id="app" data-forma-page="test-page"',
      'CLOSE_TAG div',
    ]);
    expect(getSlots(binary)).toEqual([]);
    expect(getIslands(binary)).toEqual([]);
    assertBinaryInvariants(binary);

    // OPEN_TAG: 1 + 4 + 2 + 2*(4+4) = 23 bytes; CLOSE_TAG: 1 + 4 = 5 bytes.
    expect(readSections(binary).opcodeSize).toBe(23 + 5);
  });

  it('placeholder IR names the page it was generated for', () => {
    // The page name is the only thing that varies between placeholders — it is
    // what the client-side mount keys off.
    const strings = readStringTable(
      generatePlaceholderIr('tenant-dashboard'),
      readSections(generatePlaceholderIr('tenant-dashboard')).stringTableOffset,
    );
    expect(strings).toEqual(['div', 'id', 'app', 'data-forma-page', 'tenant-dashboard']);
  });
});
