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

it('server arithmetic names the declared-prop and browser-only alternatives', () => {
  const { result, diagnostics, error } = emit(core + "function Page(p:{total:number}){return h('p',null,()=>p.total*1.2);}\nmount(()=>Page(),'#app');");
  expect(result).toBeNull(); expect(error).toBeInstanceOf(PropsSchemaError);
  const diagnostic = diagnostics.find(d => d.code === 'BUILD-610');
  expect(diagnostic?.line).toBe(2);
  expect(`${diagnostic?.message} ${diagnostic?.fix}`).toMatch(/own prop|declared prop|handler/);
  expect(`${diagnostic?.message} ${diagnostic?.fix}`).toContain('browserOnly');
});
