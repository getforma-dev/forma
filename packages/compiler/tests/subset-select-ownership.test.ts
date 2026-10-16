import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDiagnostics } from '../src/diagnostics';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { PropsSchemaError } from '../src/props-schema';
import { getIslands, parseOpcodeList } from './helpers/fmir';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
const core = "import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';\n";
const choice = "export function Choice(p:{value:string;selected:boolean}){return h('option',{value:p.value,selected:p.selected},'B');}\n";
const call = "Choice({value:'b',selected:false})";
function source({ child = call, props = 'value:()=>value()', signal = "'b'", register = 'Picker,Choice', declaration = choice, extra = '' } = {}) {
  return core + declaration + extra + `export function Picker(){const [value]=createSignal(${signal});return h('select',{${props}},h('option',{value:'a'},'A'),${child});}\nexport function Page(){return h('main',null,Picker());}\nactivateIslands({${register}});mount(()=>Page(),'#app');\n`;
}
function emit(code: string, files: Record<string, string> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma-select-owner-'))); roots.push(root);
  for (const [name, content] of Object.entries({ 'app.ts': code, ...files })) { const file = join(root, name); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, content); }
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let error: unknown;
  const { result, diagnostics } = collectDiagnostics(() => { try { return generateRealIr(join(root, 'app.ts')); } catch (caught) { error = caught; return null; } });
  return { result, diagnostics, error };
}

describe('BUILD-617: native select value ownership', () => {
  const refused: [string, string, Record<string, string>?][] = [
    ['historical option under a different bound-select island', source()],
    ['static select value', source({ props: "value:'b'" })],
    ['case-insensitive HTML tags', source().replace("h('select'", "h('SELECT'").replace("h('option'", "h('OPTION'")],
    ['multiple select value', source({ props: "multiple:true,value:'b'" })],
    ['registered optgroup', source({ declaration: "export function Choice(p:{value:string;selected:boolean}){return h('optgroup',{label:'Group'},h('option',{value:p.value,selected:p.selected},'B'));}\n" })],
    ['ordinary helper between select and child', source({ child: 'Helper()', extra: `function Helper(){return h('optgroup',{label:'Helper'},${call});}\n` })],
    ['conditional placement', source({ child: `()=>true?${call}:h('option',{value:'c'},'C')` })],
    ['list placement', source({ child: "createList(rows,r=>r.value,r=>Choice({value:r.value,selected:r.selected}))", extra: "const [rows]=createSignal([{value:'b',selected:false},{value:'c',selected:false}]);\n" })],
    ['imported child declaration', source({ declaration: "import {Choice} from './choice';\n" }), { 'choice.ts': core + choice }],
  ];
  it.each(refused)('%s refuses at the child/select chain', (_name, code, files) => {
    const { result, diagnostics, error } = emit(code, files);
    expect(result).toBeNull();
    expect(error).toBeInstanceOf(PropsSchemaError);
    expect((error as PropsSchemaError).code).toBe('BUILD-617');
    const diagnostic = diagnostics.find(d => d.code === 'BUILD-617');
    expect(diagnostic?.line).toBeGreaterThan(0);
    expect(diagnostic?.column).toBeGreaterThan(0);
    expect(diagnostic?.message).toContain('Choice');
    expect(diagnostic?.message).toContain('select');
    expect(diagnostic?.message).toContain('Picker');
    expect(diagnostic?.fix).toContain('unregistered');
    expect(diagnostic?.fix).not.toContain('browserOnly');
  });

  it.each([
    ['registered option under unbound select', source({ props: '' }), ['Picker', 'Choice']],
    ['ordinary option helper inside its owning island', source({ register: 'Picker' }), ['Picker']],
    ['registered optgroup under unbound select', source({ props: '', declaration: "export function Choice(p:{value:string;selected:boolean}){return h('optgroup',{label:'Group'},h('option',{value:p.value,selected:p.selected},'B'));}\n" }), ['Picker', 'Choice']],
    ['unrelated bound sibling select', source({ props: '' }).replace("h('main',null,Picker())", "h('main',null,h('select',{value:'a'},h('option',{value:'a'},'A')),Picker())"), ['Picker', 'Choice']],
  ] as const)('%s remains admitted with its native islands and benign option', (_name, code, islands) => {
    const { result, diagnostics, error } = emit(code);
    expect(error).toBeUndefined(); expect(diagnostics).toEqual([]);
    expect(getIslands(result!.binary).map(island => island.name)).toEqual(islands);
    expect(parseOpcodeList(result!.binary).join('\n')).toContain('OPEN_TAG option');
    expect(parseOpcodeList(result!.binary).join('\n')).toContain('TEXT "A"');
  });
});

it('preserves canonical bytes captured from the pre-617 compiler for admitted near misses', () => {
  const baseline = JSON.parse(readFileSync(join(__dirname, 'fixtures/subset-select/baseline.json'), 'utf8'));
  expect(baseline.cases.map((row: {name:string}) => row.name)).toEqual(['unbound-child', 'same-owner-helper', 'unbound-uppercase', 'bound-uppercase-helper']);
  for (const row of baseline.cases) {
    const {result, diagnostics, error} = emit(row.source);
    expect(error, row.name).toBeUndefined(); expect(diagnostics, row.name).toEqual([]);
    expect(result!.binary.length, row.name).toBe(row.bytes);
    expect(createHash('sha256').update(result!.binary).digest('hex'), row.name).toBe(row.sha256);
  }
});
