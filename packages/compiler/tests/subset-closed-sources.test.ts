import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDiagnostics } from '../src/diagnostics';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { PropsSchemaError } from '../src/props-schema';
import { getSlots, parseOpcodeList } from './helpers/fmir';
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function emit(code: string) {
  const root = mkdtempSync(join(tmpdir(), 'forma-subset-')); roots.push(root);
  const entry = join(root, 'app.ts'); writeFileSync(entry, code);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let error: unknown;
  const { result, diagnostics } = collectDiagnostics(() => { try { return generateRealIr(entry); } catch (caught) { error = caught; return null; } });
  return { result, diagnostics, error };
}
const core = "import {h,mount,createSignal,createList} from '@getforma/core';\n";
const list = (expression: string) => core + `function Page(){const [items]=createSignal([{id:'a',label:'A',active:true},{id:'b',label:'B',active:false}]);return h('ul',null,createList(${expression},row=>row.id,row=>h('li',null,row.label)));}\nmount(()=>Page(),'#app');`;

it('the historical derived literal LIST source refuses instead of emitting empty rows', () => {
  const { result, diagnostics, error } = emit(list('()=>items().filter(row=>row.active)'));
  expect(result).toBeNull(); expect(error).toBeInstanceOf(PropsSchemaError);
  expect(diagnostics.some(d => d.code === 'BUILD-610')).toBe(true);
  expect(diagnostics.every(d => d.code !== 'BUILD-303')).toBe(true);
});

it('literal accessor and declared array rows remain represented without invented server slots', () => {
  for (const code of [list('()=>items()'), core + "function Page(p:{items:{id:string;label:string}[]}){return h('ul',null,createList(()=>p.items,row=>row.id,row=>h('li',null,row.label)));}\nmount(()=>Page(),'#app');"]) {
    const { result, diagnostics, error } = emit(code);
    expect(error).toBeUndefined(); expect(diagnostics).toEqual([]);
    expect(parseOpcodeList(result!.binary).some(op => op.startsWith('LIST '))).toBe(true);
    expect(getSlots(result!.binary).filter(slot => slot.source === 0).map(slot => slot.name).filter(name => /^(text:\d|attr:)/.test(name))).toEqual([]);
  }
});
