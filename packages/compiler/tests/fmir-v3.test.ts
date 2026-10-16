import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { IrEmitContext, type SchemaType, type PropsSchema } from '../src/ir-emit';
import { baseWriterVersion, COMPILER_WRITER_VERSION, crc32, dumpFmir, encodeFmirSections, readFmirContainer } from '../src/fmir';
import * as C from '../src/fmir-constants';

const root = resolve(__dirname, '../../..');
const fixtures = resolve(root, 'crates/forma-ir/tests/fixtures/fmir-v3');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(fixtures, name)));
const enc = new TextEncoder();
// Historical exact-stage examples remain byte oracles for their original five
// sections. Current producers also write section10; this explicit test-only
// reconstruction never claims the old island is accepted by the native reader.
function historicalSections(bytes:Uint8Array):Uint8Array {
  const module=readFmirContainer(bytes);
  return encodeFmirSections(module.sections.filter(section=>section.id!==C.SECTION_ISLAND_CONTRACTS),module.writer);
}

function workedExample(): IrEmitContext {
  const ctx = new IrEmitContext();
  for (const value of ['main', 'h1', 'title', 'page.tsx']) ctx.addString(value);
  ctx.addSlot('title', C.SLOT_TYPE_TEXT, C.SLOT_SOURCE_SERVER);
  ctx.setPropsSchema([[{ name: 'title', file: 'page.tsx', line: 3, column: 23, type: { kind: 'string' } }]]);
  for (const tag of [0, 1]) { ctx.emit(C.OP_OPEN_TAG); ctx.emitU32(tag); ctx.emitU16(0); }
  ctx.emit(C.OP_DYN_TEXT); ctx.emitU16(0); ctx.emitU16(0);
  for (const tag of [1, 0]) { ctx.emit(C.OP_CLOSE_TAG); ctx.emitU32(tag); }
  return ctx;
}
function schemaFor(type: SchemaType): PropsSchema { return [[{ name: 'value', file: 'page.tsx', line: 1, column: 1, type }]]; }
function listContext(): IrEmitContext {
  const ctx = new IrEmitContext();
  const array = ctx.addSlot('rows', C.SLOT_TYPE_ARRAY), item = ctx.addSlot('row', C.SLOT_TYPE_OBJECT);
  ctx.emit(C.OP_LIST); ctx.emitU16(array); ctx.emitU16(item); ctx.emitU32(0);
  return ctx;
}
function restamp(bytes: Uint8Array): Uint8Array {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(18, crc32(bytes.subarray(0, 18), bytes.subarray(22)), true);
  return bytes;
}

describe('FMIR v3 wire contract', () => {
  it('uses current generated constants in both languages', () => {
    expect(() => execFileSync(process.execPath, [resolve(root, 'scripts/generate-fmir-constants.mjs'), '--check'])).not.toThrow();
  });
  it('encodes the independently authored worked example byte for byte', () => {
    const bytes = historicalSections(workedExample().toBinary());
    expect(bytes).toEqual(fixture('PASS-good-a.ir'));
    expect(bytes.length).toBe(183);
    expect(readFmirContainer(bytes)).toMatchObject({ writer: [3, 0, 0], bodyLength: 159, checksum: 0xfa39788c });
    expect(dumpFmir(bytes).split('\n').slice(0, 3)).toEqual([
      'FMIR v3 writer=3.0.0 body_len=159 crc=fa39788c',
      'SECTION id=0001 flags=0001 offset=88 length=29',
      'HEX 0100000000000001010000000000050000000002010000000200000000',
    ]);
  });
  it('uses the compiler package base version, including patch and excluding suffixes', () => {
    expect(COMPILER_WRITER_VERSION).toEqual(baseWriterVersion(JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')).version));
    expect(baseWriterVersion('3.2.7-alpha.1+build.6')).toEqual([3, 2, 7]);
    expect(() => baseWriterVersion('3.2')).toThrow();
    expect(() => baseWriterVersion('65536.0.0')).toThrow(/u16/);
    expect(readFmirContainer(fixture('LOAD-108-writer-3.0.1.ir')).writer).toEqual([3, 0, 1]);
    for (const version of ['3.1.0', '2.9.0']) expect(() => readFmirContainer(fixture(`LOAD-108-writer-${version}.ir`))).toThrow(/LOAD-108/);
  });
  it('runs the shared compatibility table through actual encoded headers', () => {
    const pairs = JSON.parse(readFileSync(resolve(root, 'crates/forma-ir/tests/fixtures/compatibility/version-pairs.json'), 'utf8')) as {reader: string; writer: string; accepted: boolean}[];
    const sections = readFmirContainer(fixture('PASS-good-a.ir')).sections;
    for (const {reader, writer, accepted} of pairs) {
      const bytes = encodeFmirSections(sections, baseWriterVersion(writer));
      const read = () => readFmirContainer(bytes, baseWriterVersion(reader));
      if (accepted) expect(read().writer).toEqual(baseWriterVersion(writer));
      else expect(read).toThrow(`writer ${baseWriterVersion(writer).join('.')} is outside reader ${baseWriterVersion(reader).join('.')}`);
    }
  });
  it('preserves raw container bytes while authenticating the native state overlay', () => {
    const rows = (name: string) => readFileSync(resolve(fixtures, name), 'utf8').trim().split('\n').slice(1).map(line => line.split('\t'));
    const historical = new Map(rows('index.tsv').map(([name, expected]) => [name, expected]));
    const window = new Map(rows('window-expectations.tsv').map(([name,expected])=>[name,expected]));
    const stateChanges:string[]=[];
    const changes: string[] = [];
    for (const [name, expected] of rows('state-expectations.tsv')) {
      if(window.get(name)!==expected)stateChanges.push(name);
      if (historical.get(name) !== expected) changes.push(name);
      // The diagnostic container reader validates header/table sections. Rust's
      // production loader additionally validates each payload and opcode operand.
      if (name.startsWith('LOAD-108-') || expected === 'PASS') {
        if (expected === 'PASS') {
          const bytes = fixture(name), module = readFmirContainer(bytes);
          expect(encodeFmirSections(module.sections, module.writer), name).toEqual(bytes);
        } else expect(() => readFmirContainer(fixture(name)), name).toThrow(expected);
      }
    }
    expect(changes).toEqual(['PASS-good-b.ir','LOAD-108-writer-3.0.1.ir','PASS-positions-absent.ir']);
    expect(stateChanges).toEqual(['PASS-good-b.ir','PASS-positions-absent.ir']);
    // Native required10 refusal is a payload rule. The diagnostic inspector
    // still preserves these original bytes without pretending to validate them.
    for(const name of stateChanges){const bytes=fixture(name),module=readFmirContainer(bytes);expect(encodeFmirSections(module.sections,module.writer)).toEqual(bytes);}
  });
  it('pins streaming CRC and skips rather than zero-fills its field', () => {
    expect(crc32(enc.encode('123456789'))).toBe(C.CRC_CHECK_VALUE);
    expect(crc32(enc.encode('123'), enc.encode('456789'))).toBe(0xcbf43926);
    const bytes = historicalSections(workedExample().toBinary());
    expect(crc32(bytes.subarray(0, 18), bytes.subarray(22))).toBe(0xfa39788c);
    expect(crc32(bytes.subarray(0, 18), new Uint8Array(4), bytes.subarray(22))).not.toBe(0xfa39788c);
  });
  it('applies header and table checks in the prescribed order', () => {
    const early = [
      'LOAD-102-bad-signature.ir', 'LOAD-102-v2-module.ir', 'LOAD-102-pre-v3-version-7.ir',
      'LOAD-104-short-by-one.ir', 'LOAD-104-long-by-one.ir', 'LOAD-104-crc-flipped-bytecode.ir',
      'LOAD-104-crc-flipped-table.ir', 'LOAD-104-crc-field-flipped.ir', 'LOAD-103-header-pad-nonzero.ir',
      'LOAD-103-table-reserved-nonzero.ir', 'LOAD-103-reserved-flag-bit.ir', 'LOAD-103-duplicate-section-id.ir',
      'LOAD-103-unordered-table.ir', 'LOAD-103-offset-in-header.ir', 'LOAD-103-gap-between-sections.ir',
      'LOAD-103-table-does-not-fit.ir', 'LOAD-105-missing-schema-section.ir', 'LOAD-106-unknown-required-0x0100.ir',
      'LOAD-107-section-count-65.ir',
    ];
    for (const name of early) expect(() => readFmirContainer(fixture(name)), name).toThrow(name.slice(0, 8));
    expect(() => readFmirContainer(new Uint8Array(C.MAX_MODULE_SIZE + 1))).toThrow(/LOAD-107/);
    for (const length of [0, 8, 22, 23]) expect(() => readFmirContainer(new Uint8Array(length))).toThrow(/LOAD-103/);
    expect(() => readFmirContainer(fixture('LOAD-102-pre-v3-version-7.ir'))).toThrow(/header version 7/);
    const shortTable = workedExample().toBinary().slice(0, 26);
    const shortView = new DataView(shortTable.buffer); shortView.setUint32(14, 2, true); shortView.setUint16(24, 65, true);
    expect(() => readFmirContainer(restamp(shortTable))).toThrow(/LOAD-107/);
    const corrupt = workedExample().toBinary(); corrupt[22] = 1;
    expect(() => readFmirContainer(corrupt)).toThrow(/LOAD-104/);
    expect(() => readFmirContainer(restamp(corrupt))).toThrow(/LOAD-103/);
  });
  it('preserves unknown optional sections and island extension bytes in its diagnostic dump', () => {
    const known = readFmirContainer(fixture('PASS-good-b.ir'));
    const sections = known.sections.map(s => ({ ...s, bytes: s.bytes.slice() }));
    const island = sections.find(s => s.id === C.SECTION_ISLANDS)!;
    const extended = new Uint8Array(island.bytes.length + 3); extended.set(island.bytes); extended.set([9, 8, 7], island.bytes.length);
    const v = new DataView(extended.buffer); v.setUint16(2, v.getUint16(2, true) + 3, true); island.bytes = extended;
    sections.push({ id: 0x8000, flags: 0, offset: 0, length: 3, bytes: new Uint8Array([0, 255, 127]) });
    const bytes = encodeFmirSections(sections);
    const dump = dumpFmir(bytes); expect(dump).toContain('HEX 00ff7f\n'); expect(dump).toContain('090807\n');
    const lines = dump.trimEnd().split('\n');
    const decoded = [];
    for (let i = 1; i < lines.length; i += 2) {
      const match = /^SECTION id=([0-9a-f]{4}) flags=([0-9a-f]{4}) offset=(\d+) length=(\d+)$/.exec(lines[i]!)!;
      decoded.push({ id: parseInt(match[1]!, 16), flags: parseInt(match[2]!, 16), bytes: Uint8Array.from(Buffer.from(lines[i + 1]!.slice(4), 'hex')) });
    }
    expect(encodeFmirSections(decoded)).toEqual(bytes);
  });
  it('roundtrips every valid spec fixture and emits a required empty schema for a bare encoder', () => {
    for (const name of readdirSync(fixtures).filter(name => name.startsWith('PASS-'))) {
      const bytes = fixture(name), module = readFmirContainer(bytes);
      expect(encodeFmirSections(module.sections, module.writer), name).toEqual(bytes);
    }
    const module = readFmirContainer(new IrEmitContext().toBinary());
    expect(module.sections.map(s => [s.id, s.flags])).toEqual([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [10, 1]]);
    expect([...module.sections[4]!.bytes]).toEqual([1, 0, 0, 0]);
    expect(() => new IrEmitContext().toBinary()).not.toThrow();
  });
});

describe('FMIR v3 payload emission', () => {
  it('preserves the historical island/list/schema/position sections and adds the current contract', () => {
    const ctx = new IrEmitContext();
    for (const text of ['main', 'ul', 'li', 'Counter', 'rows', 'row', 'id', 'label', 'page.tsx', 'Counter.tsx', 'count']) ctx.addString(text);
    ctx.addSlot('rows', 4, 0); ctx.addSlot('row', 5, 1); ctx.addSlot('label', 1, 1); ctx.addSlot('count', 3, 0, enc.encode('7'));
    const field = (name: string, file: string, line: number, column: number, type: SchemaType) => ({ name, file, line, column, type });
    ctx.setPropsSchema([
      [field('rows', 'page.tsx', 2, 3, { kind: 'array', element: { kind: 'object', object: 2 } }), field('count', 'page.tsx', 3, 3, { kind: 'number' })],
      [field('count', 'Counter.tsx', 1, 30, { kind: 'number' })],
      [field('id', 'page.tsx', 5, 3, { kind: 'number' }), field('label', 'page.tsx', 6, 3, { kind: 'string' })],
    ]);
    const open = (tag: number) => { ctx.emit(C.OP_OPEN_TAG); ctx.emitU32(tag); ctx.emitU16(0); };
    const close = (tag: number) => { ctx.emit(C.OP_CLOSE_TAG); ctx.emitU32(tag); };
    open(0); open(1);
    ctx.emit(C.OP_LIST); ctx.emitU16(0); ctx.emitU16(1); ctx.emitU32(26);
    ctx.emit(C.OP_PROP); ctx.emitU16(1); ctx.emitU32(7); ctx.emitU16(2);
    open(2); ctx.emit(C.OP_DYN_TEXT); ctx.emitU16(2); ctx.emitU16(0); close(2); close(1);
    const island = ctx.addIsland('Counter', 1, [3], ctx.opcodeLen(), 1);
    ctx.setIslandContract(island,'ssr',[]);
    ctx.emit(C.OP_ISLAND_START); ctx.emitU16(island); open(3);
    ctx.emit(C.OP_DYN_TEXT); ctx.emitU16(3); ctx.emitU16(1); close(3);
    ctx.emit(C.OP_ISLAND_END); ctx.emitU16(island); close(0);
    ctx.addKeyPath(14, ['id']);
    ctx.setSourcePositions([{ opcodeOffset: 0, file: 'page.tsx', line: 8, column: 5, component: 'main' }, { opcodeOffset: 54, file: 'page.tsx', line: 12, column: 7, component: 'Counter' }]);
    const current=readFmirContainer(ctx.toBinary());
    expect(current.sections.find(s=>s.id===C.SECTION_ISLAND_CONTRACTS)?.flags).toBe(C.SECTION_REQUIRED);
    const old=readFmirContainer(fixture('PASS-good-b.ir'));
    // The legacy table had an empty digest. All other payload sections remain
    // exact; the native suite separately refuses this historical island.
    for(const section of old.sections.filter(s=>s.id!==C.SECTION_ISLANDS))expect(current.sections.find(s=>s.id===section.id)?.bytes).toEqual(section.bytes);
    expect(encodeFmirSections(old.sections,old.writer)).toEqual(fixture('PASS-good-b.ir'));
  });
  it.each([C.OP_OPEN_TAG, C.OP_CLOSE_TAG, C.OP_VOID_TAG, C.OP_TEXT, C.OP_DYN_ATTR, C.OP_PROP])('refuses out-of-range strings in opcode %i before writing', op => {
    const ctx = new IrEmitContext(); ctx.addSlot('value', 1);
    ctx.emit(op);
    if (op === C.OP_PROP) ctx.emitU16(0);
    ctx.emitU32(99);
    if (op === C.OP_OPEN_TAG || op === C.OP_VOID_TAG || op === C.OP_DYN_ATTR || op === C.OP_PROP) ctx.emitU16(0);
    expect(() => ctx.toBinary()).toThrow(/string index/);
  });
  it.each([C.OP_OPEN_TAG, C.OP_VOID_TAG])('checks attribute keys and values for opcode %i', op => {
    for (const pair of [[99, 0], [0, 99]]) {
      const ctx = new IrEmitContext(); ctx.addString('div'); ctx.emit(op); ctx.emitU32(0); ctx.emitU16(1);
      ctx.emitU32(pair[0]!); ctx.emitU32(pair[1]!); expect(() => ctx.toBinary()).toThrow(/string index/);
    }
  });
  it.each([0, ...C.RESERVED_OPCODES, 0xff])('never emits reserved or unassigned opcode %i', opcode => {
    const ctx = new IrEmitContext(); ctx.emit(opcode); expect(() => ctx.toBinary()).toThrow(/invalid or reserved opcode/);
  });
  it('checks references, region tiling, numeric widths and declared island inputs', () => {
    const unknown = new IrEmitContext(); unknown.emit(C.OP_DYN_TEXT); unknown.emitU16(3); unknown.emitU16(0);
    expect(() => unknown.toBinary()).toThrow(/undeclared slot/);
    const truncated = listContext(); truncated.patchU32(5, 1); expect(() => truncated.toBinary()).toThrow(/truncated/);
    expect(() => truncated.emitU16(65536)).toThrow(/u16/);
    expect(() => truncated.emitU32(-1)).toThrow(/u32/);
    const island = new IrEmitContext(); island.addSlot('value', 1); const id=island.addIsland('Counter', 1, new Array(32760).fill(0), 0, 0);
    expect(() => island.toBinary()).toThrow(/no declared contract/);
    island.setIslandContract(id,'ssr',[]);
    expect(() => island.toBinary()).toThrow(/input count must equal/);
    const unknownIsland = new IrEmitContext(); unknownIsland.emit(C.OP_ISLAND_START); unknownIsland.emitU16(0);
    expect(() => unknownIsland.toBinary()).toThrow(/undeclared island/);
  });
  it.each([[2, 'TRUE'], [3, 'seven'], [3, 'NaN'], [3, ' 1'], [3, '1e999'], [4, '[1]'], [5, '{}']])('refuses type %i default %s at build', (type, value) => {
    const ctx = new IrEmitContext(); ctx.addSlot('value', Number(type), 0, enc.encode(String(value)));
    expect(() => ctx.toBinary()).toThrow(/default does not parse/);
  });
  it.each([[2, 'true'], [2, 'false'], [3, '+1.2e-3'], [3, '.25'], [4, '[]'], [5, '']])('accepts type %i default %s', (type, value) => {
    const ctx = new IrEmitContext(); ctx.addSlot('value', Number(type), 0, enc.encode(String(value)));
    expect(() => ctx.toBinary()).not.toThrow();
  });
  it('bounds schemas and refuses cycles, repeated names, invalid positions and optional nesting', () => {
    const cases: PropsSchema[] = [[], new Array(1025).fill([]), schemaFor({ kind: 'object', object: 0 }), schemaFor({ kind: 'object', object: 1 }), schemaFor({ kind: 'optional', inner: { kind: 'optional', inner: { kind: 'string' } } })];
    const f = schemaFor({ kind: 'string' })[0]![0]!;
    cases.push([[f, f]], [[{ ...f, line: 0 }]], [[{ ...f, column: 0 }]], [new Array(1025).fill(f)], schemaFor({ kind: 'enum', variants: new Array(1025).fill('v') }));
    for (const schema of cases) { const ctx = new IrEmitContext(); ctx.setPropsSchema(schema); expect(() => ctx.toBinary()).toThrow(); }
    for (const count of [16, 17]) {
      let type: SchemaType = { kind: 'string' }; for (let i = 0; i < count; i++) type = { kind: 'array', element: type };
      const ctx = new IrEmitContext(); ctx.setPropsSchema(schemaFor(type));
      if (count === 16) expect(() => ctx.toBinary()).not.toThrow(); else expect(() => ctx.toBinary()).toThrow(/nesting/);
    }
    for (const type of [{ kind: 'boolean' }, { kind: 'date' }, { kind: 'enum', variants: ['red', 'blue'] }, { kind: 'optional', inner: { kind: 'number' } }] as SchemaType[]) {
      const ctx = new IrEmitContext(); ctx.setPropsSchema(schemaFor(type)); expect(() => ctx.toBinary()).not.toThrow();
    }
  });
  it('emits key paths only when present, requires unique LIST boundaries, and validates positions', () => {
    const bare = listContext(); expect(readFmirContainer(bare.toBinary()).sections.map(s => s.id)).not.toContain(6);
    for (const count of [0, 33]) { const ctx = listContext(); ctx.addKeyPath(0, new Array(count).fill('id')); expect(() => ctx.toBinary()).toThrow(/1..32/); }
    const wrong = listContext(); wrong.addKeyPath(1, ['id']); expect(() => wrong.toBinary()).toThrow(/boundaries/);
    const duplicate = listContext(); duplicate.addKeyPath(0, ['id']); duplicate.addKeyPath(0, ['id']); expect(() => duplicate.toBinary()).toThrow(/unique/);
    const full = listContext(); full.addKeyPath(0, new Array(32).fill('id'));
    full.setSourcePositions([{ opcodeOffset: 0, file: 'page.tsx', line: 1, column: 3, component: 'Page' }]);
    expect(readFmirContainer(full.toBinary()).sections.filter(s=>s.id===6||s.id===7).map(s => [s.id, s.flags])).toEqual([[6, 1], [7, 0]]);
    full.setSourcePositions([{ opcodeOffset: 1, file: 'page.tsx', line: 1, column: 3, component: 'Page' }]);
    expect(() => full.toBinary()).toThrow(/eligible opcode/);
  });
});
