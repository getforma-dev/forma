import { describe, expect, it } from 'vitest';
import { IrEmitContext } from '../src/ir-emit';
import * as C from '../src/fmir-constants';
import { readFmirContainer } from '../src/fmir';
import { getIslands } from './helpers/fmir';
const field = (name: string) => ({ name, type: { kind: 'string' as const }, file: 'page.ts', line: 1, column: 1 });
function host(ctx: IrEmitContext, id: number): void {
  ctx.emit(C.OP_ISLAND_START); ctx.emitU16(id);
  const div = ctx.addString('div');
  ctx.emit(C.OP_OPEN_TAG); ctx.emitU32(div); ctx.emitU16(0);
  ctx.emit(C.OP_CLOSE_TAG); ctx.emitU32(div);
  ctx.emit(C.OP_ISLAND_END); ctx.emitU16(id);
}
describe('island contract wire integration', () => {
  it('emits the required empty section for a page without islands', () => {
    const ctx = new IrEmitContext();
    const section = readFmirContainer(ctx.toBinary()).sections.find(s => s.id === C.SECTION_ISLAND_CONTRACTS);
    expect(section?.flags).toBe(C.SECTION_REQUIRED);
    expect(Array.from(section!.bytes)).toEqual([0, 0, 0, 0]);
  });
  it('keeps repeated declared inputs and the exact digest in the island table', () => {
    const ctx = new IrEmitContext();
    ctx.setPropsSchema([[field('title')]]);
    const title = ctx.addSlot('title', C.SLOT_TYPE_TEXT, C.SLOT_SOURCE_SERVER);
    const schemaObject = ctx.appendPropsSchema([[field('left'), field('right')]]);
    const id = ctx.addIsland('Badge', C.TRIGGER_LOAD, [title, title], ctx.opcodeLen(), schemaObject);
    ctx.setIslandContract(id, 'ssr', [
      { kind: 'text', value: { kind: 'prop', path: ['left'] } },
      { kind: 'text', value: { kind: 'prop', path: ['right'] } },
    ]);
    host(ctx, id);
    const binary = ctx.toBinary();
    const island = getIslands(binary)[0]!;
    expect(island.slotIds).toEqual([title, title]);
    const entry = readFmirContainer(binary).sections.find(s => s.id === C.SECTION_ISLANDS)!.bytes;
    expect(entry[18]).toBe(8);
    expect(Buffer.from(entry.subarray(19, 27)).toString('hex')).toBe('096cc9510f0b99ee');
    expect(ctx.getIslands()[0]!.contract?.digest).toBe('096cc9510f0b99ee');
  });
  it('refuses absent contracts, missing fields and wrong constant ownership', () => {
    const missing = new IrEmitContext();
    const id = missing.addIsland('Missing', C.TRIGGER_LOAD, [], 0); host(missing, id);
    expect(() => missing.toBinary()).toThrow(/contract/);
    const incomplete = new IrEmitContext(); incomplete.setPropsSchema([[field('title')]]);
    const child = incomplete.addIsland('MissingInput', C.TRIGGER_LOAD, [], 0, 0);
    incomplete.setIslandContract(child, 'ssr', []); host(incomplete, child);
    expect(() => incomplete.toBinary()).toThrow(/input|field/);
    const constant = new IrEmitContext();
    const value = constant.addConstantSlot('', C.SLOT_TYPE_TEXT);
    constant.emit(C.OP_PROP); constant.emitU16(value); constant.emitU32(constant.addString('x')); constant.emitU16(value);
    expect(() => constant.toBinary()).toThrow(/constant.*destination/);
    const unused = new IrEmitContext(); unused.addConstantSlot(null, C.SLOT_TYPE_TEXT);
    expect(() => unused.toBinary()).toThrow(/unreferenced constant/);
  });
  it('encodes explicit empty-string defaults and nullish operands without text ambiguity', () => {
    const ctx = new IrEmitContext();
    const source = ctx.addSlot('label', C.SLOT_TYPE_TEXT);
    const fallback = ctx.addConstantSlot('', C.SLOT_TYPE_TEXT);
    const destination = ctx.addTemporarySlot(C.SLOT_TYPE_TEXT);
    ctx.emit(C.OP_COALESCE); ctx.emitU16(source); ctx.emitU16(fallback); ctx.emitU16(destination);
    ctx.emit(C.OP_DYN_TEXT); ctx.emitU16(destination); ctx.emitU16(ctx.nextMarker());
    const sections = readFmirContainer(ctx.toBinary()).sections;
    expect(Array.from(sections.find(s => s.id === C.SECTION_BYTECODE)!.bytes.subarray(0, 7))).toEqual([19, 0, 0, 1, 0, 2, 0]);
    expect(Buffer.from(sections.find(s => s.id === C.SECTION_ISLAND_CONTRACTS)!.bytes).toString('hex')).toBe('00000100010003000000040000');
  });
});
