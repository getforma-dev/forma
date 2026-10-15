import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { build } from 'esbuild';
import { createIslandRegistry } from '../src/island-registry';
import { collectAdoptionEdits } from '../src/adoption-hooks';
import { applySourceEdits } from '../src/source-edits';
import { canonicalIslandSchema, encodeBindings } from '../src/fmir-contracts';
import { formaSsrPlugin, generateRealIr } from '../src/esbuild-ssr-plugin';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const prelude = `import {h,Fragment,createSignal,createList,activateIslands,mount} from '@getforma/core';\n`;
function fixture(body: string, other: Record<string, string> = {}, names = 'Counter') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'forma-adoption-conditional-'))); directories.push(dir);
  const entry = join(dir, 'entry.tsx'), source = prelude + body + `\nexport function register(){activateIslands({${names}})};`;
  const sources = new Map([[entry, source]]);
  for (const [name, contents] of Object.entries(other)) sources.set(join(dir, name), contents);
  for (const [file, contents] of sources) writeFileSync(file, contents);
  const registry = createIslandRegistry(entry), edits = collectAdoptionEdits(registry);
  const transformed = new Map([...sources].map(([file, text]) => [file, applySourceEdits(text, edits.get(file) ?? [])]));
  for (const text of transformed.values()) parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  return { dir, entry, source, sources, registry, edits, transformed, text: transformed.get(entry)! };
}
const conditionalCount = (text: string) => [...text.matchAll(/__forma_adoptConditional\w*\(/g)].length;
async function runtime(f: ReturnType<typeof fixture>) {
  const root = resolve('../core/src'), wrapper = join(f.dir, 'runtime.ts');
  writeFileSync(wrapper, `export * from './entry'; export {withAdoptionDescription} from ${JSON.stringify(join(root, 'dom/adoption-description.ts'))};export {withAdoptionSink} from ${JSON.stringify(join(root, 'reactive/adoption-hooks.ts'))};`);
  const result = await build({ entryPoints: [wrapper], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', jsxFactory: 'h', jsxFragment: 'Fragment', alias: { '@getforma/core': join(root, 'index.ts') }, plugins: [{ name: 'original-conditional-hooks', setup(plugin) { plugin.onLoad({ filter: /\.[jt]sx?$/ }, args => { const contents = f.transformed.get(args.path); return contents === undefined ? undefined : { contents, loader: 'tsx' }; }); } }] });
  const output = { exports: {} as any };
  runInNewContext(result.outputFiles[0]!.text, { module: output, exports: output.exports, console, queueMicrotask, setTimeout, clearTimeout, TextEncoder, TextDecoder, require: () => { throw new Error('unexpected require'); } });
  return output.exports;
}

describe('original DOM conditional provenance', () => {
  it('records JSX, h, arrow-reader and list-row conditionals while preserving canonical bytes', () => {
    const f = fixture(`export function Counter(p:{show:boolean;rows:{id:string;live:boolean;name:string}[]}){return h('main',null,p.show?h('b',null,'direct'):null,()=>p.show?h('b',null,'reader'):null,<aside>{p.show?<b>jsx</b>:null}</aside>,createList(()=>p.rows,r=>r.id,r=>r.live?h('li',null,r.name):null));}`);
    const island = f.registry.entries()[0]!.island, analysis = island.analyze();
    const before = { schema: canonicalIslandSchema(island.declared.schema, 0), bindings: Buffer.from(encodeBindings('ssr', analysis.bindings)) };
    expect(analysis.adoption!.conditionals).toHaveLength(4);
    expect(conditionalCount(f.text)).toBe(4);
    collectAdoptionEdits(f.registry);
    expect(canonicalIslandSchema(island.declared.schema, 0)).toEqual(before.schema);
    expect(Buffer.from(encodeBindings('ssr', island.analyze().bindings))).toEqual(before.bindings);
    expect(analysis.bindings.map(record => record.kind)).toEqual(['show', 'show', 'show', 'list']);
  });

  it('retains lazy test and branch reads in both direct and arrow-reader source', async () => {
    const f = fixture(`export function Counter(p:{ok:boolean;left:string;right:string}){return p.ok?p.left:p.right;}`);
    const r = await runtime(f), reads: string[] = [];
    const props = { get ok() { reads.push('test'); return true; }, get left() { reads.push('left'); return 'left'; }, get right() { reads.push('right'); return 'right'; } };
    expect(r.Counter(props)).toBe('left'); expect(reads).toEqual(['test', 'left']); reads.length = 0;
    const descriptor = r.withAdoptionDescription(() => r.Counter(props));
    expect(descriptor.type).toBe('show'); expect(reads).toEqual([]);
    expect(descriptor.condition()).toBe(true); expect(descriptor.whenTrue()).toBe('left'); expect(reads).toEqual(['test', 'left']);
    const arrow = fixture(`export function Counter(p:{ok:boolean}){return h('div',null,()=>p.ok?'yes':'no');}`), a = await runtime(arrow);
    const tree = a.withAdoptionDescription(() => a.Counter({ ok: true }));
    expect(typeof tree.children[0]).toBe('function');
    expect(a.withAdoptionDescription(() => tree.children[0]()).type).toBe('show');
  });

  it('composes nested same-boundary sites, TS assertions, parentheses and punctuation inside comments', async () => {
    const f = fixture(`const marker='😀';export function Counter(p:{a:boolean;b:boolean}){return ((p.a as boolean) /* ? : 😀 */ ? (p.b ? 'yes' : 'middle') : /* ?: */ ('no' as string));}`);
    expect(conditionalCount(f.text)).toBe(2); expect(f.text).toContain('/* ? : 😀 */'); expect(f.text).toContain('/* ?: */');
    expect(f.text).toContain('(p.a as boolean)'); expect(f.text).toContain("('no' as string)");
    const r = await runtime(f);
    expect(r.Counter({ a: true, b: true })).toBe('yes'); expect(r.Counter({ a: true, b: false })).toBe('middle'); expect(r.Counter({ a: false, b: true })).toBe('no');
    const outer = r.withAdoptionDescription(() => r.Counter({ a: true, b: false }));
    const inner = r.withAdoptionDescription(() => outer.whenTrue()); expect(inner.type).toBe('show'); expect(inner.condition()).toBe(false);
  });

  it('closes nested alternate wrappers sharing one original UTF-16 endpoint in order', async () => {
    const f = fixture(`export function Counter(p:{a:boolean;b:boolean;c:boolean}){return p.a?'a':p.b?'b':p.c?'c':'d';}`);
    const sites = f.registry.entries()[0]!.island.analyze().adoption!.conditionals;
    expect(sites).toHaveLength(3); expect(new Set(sites.map(site => site.end)).size).toBe(1);
    const r = await runtime(f);
    for (const [a,b,c,expected] of [[true,false,false,'a'],[false,true,false,'b'],[false,false,true,'c'],[false,false,false,'d']]) {
      expect(r.Counter({a,b,c})).toBe(expected);
    }
    const outer = r.withAdoptionDescription(() => r.Counter({a:false,b:false,c:false}));
    const second = r.withAdoptionDescription(() => outer.whenFalse());
    const third = r.withAdoptionDescription(() => second.whenFalse());
    expect([outer.type,second.type,third.type]).toEqual(['show','show','show']); expect(third.whenFalse()).toBe('d');
  });

  it('describes each direct conditional list row without evaluating its test or branch early', async () => {
    const f = fixture(`export function Counter(p:{rows:{id:string;live:boolean;name:string}[]}){return createList(()=>p.rows,r=>r.id,r=>r.live?h('li',null,r.name):null);}`), r = await runtime(f);
    const reads: string[] = [];
    const row = {id:'a',get live(){reads.push('test');return true},get name(){reads.push('branch');return 'name'}};
    const list = r.withAdoptionDescription(() => r.Counter({rows:[row]}));
    const conditional = r.withAdoptionDescription(() => list.renderFn(row,()=>0));
    expect(conditional.type).toBe('show'); expect(reads).toEqual([]);
    expect(conditional.condition()).toBe(true); expect(reads).toEqual(['test']);
    const element = r.withAdoptionDescription(() => conditional.whenTrue());
    expect(element.children).toEqual(['name']); expect(reads).toEqual(['test','branch']);
  });

  it('composes conditional, tuple, writable and direct registered-child edits without eager child execution', async () => {
    const f = fixture(`export function Child(){return 'child'};export function Counter(p:{ok:boolean}){const[n]=createSignal('value');return p.ok?Child():h('input',{value:n});}`, {}, 'Counter,Child');
    expect(conditionalCount(f.text)).toBe(1); expect(f.text).toContain('__forma_adoptSignal('); expect(f.text).toContain('__forma_adoptWritable('); expect(f.text).toContain('__forma_adoptChild(');
    const r = await runtime(f), pairs: any[] = [], reads: any[] = [];
    const sink = { enroll: (_site: number, pair: any) => pairs.push(pair), writable: (read: any, get: any) => { reads.push(get); return read; } };
    const outer = r.withAdoptionSink(sink, () => r.withAdoptionDescription(() => r.Counter({ ok: true })));
    expect(pairs).toHaveLength(1); expect(reads).toEqual([]);
    const child = r.withAdoptionDescription(() => outer.whenTrue()); expect(child.type).toBe('component'); expect(child.component).toBe(r.Child); expect(child.args).toEqual([]);
    const input = r.withAdoptionSink(sink, () => r.withAdoptionDescription(() => outer.whenFalse()));
    expect(input.props.value()).toBe('value'); expect(reads).toEqual([pairs[0][0]]);
  });

  it('does not turn a function-valued selected branch into a second invocation', async () => {
    const f = fixture(`export function Counter(p:{ok:boolean}){return p.ok?()=> 'yes':()=> 'no';}`), r = await runtime(f);
    const selected = r.Counter({ ok: true }); expect(typeof selected).toBe('function'); expect(selected()).toBe('yes');
    const description = r.withAdoptionDescription(() => r.Counter({ ok: false }));
    expect(typeof description.whenFalse()).toBe('function'); expect(description.whenFalse()()).toBe('no');
  });

  it('leaves scalar/value ternaries and Browser-only bodies outside the DOM hook', () => {
    expect(() => fixture(`export function Counter(p:{ok:boolean}){const ignored=p.ok?'yes':'no';return 'fixed';}`)).toThrow(/BUILD-610/);
    expect(() => fixture(`export function Counter(p:{ok:boolean}){const[n]=createSignal(p.ok?'yes':'no');return n;}`)).toThrow(/BUILD-610/);
    const f = fixture(`export function Counter(p:{ok:boolean}){return h('button',{onClick:()=>p.ok?'yes':'no'},'fixed');}`);
    expect(conditionalCount(f.text)).toBe(0); expect(f.registry.entries()[0]!.island.analyze().adoption!.conditionals).toEqual([]);
    const browser = fixture(`import {browserOnly} from '@getforma/core';export const Counter=browserOnly((p:{ok:boolean})=>p.ok?window.left():window.right());`);
    expect(conditionalCount(browser.text)).toBe(0);
  });

  it('unions shared imported helper sites once, preserving hygienic names and original modules', () => {
    const f = fixture(`import {Shared} from './shared';export function Counter(p:{ok:boolean}){return Shared(p)}`, { 'shared.ts': prelude + `const __forma_adoptConditional=1;export function Shared(p){return p.ok?'yes':'no'}` });
    const second = join(f.dir, 'second.ts'); writeFileSync(second, prelude + `import {Shared} from './shared';function Other(p:{ok:boolean}){return Shared(p)};activateIslands({Other});`);
    const edits = collectAdoptionEdits([f.registry, createIslandRegistry(second), f.registry]);
    const file = join(f.dir, 'shared.ts'), text = applySourceEdits(f.sources.get(file)!, edits.get(file)!);
    expect(text.match(/__adoptionConditional as/g)).toHaveLength(1); expect(text.match(/__forma_adoptConditional_\(/g)).toHaveLength(1);
  });

  it('keeps whole FMIR and contract bytes identical through actual plugin compilation', async () => {
    const f = fixture(`export function Counter(p:{ok:boolean}){return h('section',null,()=>p.ok?h('b',null,'yes'):null)};function Page(){return h('main',null,Counter({ok:true}))};mount(Page,'#app');`);
    // The entry has one actual activation, rather than the fixture's exported registration helper.
    const source = f.source.slice(0, f.source.lastIndexOf('\nexport function register')) + '\nactivateIslands({Counter});';
    writeFileSync(f.entry, source);
    const before = generateRealIr(f.entry)!;
    const result = await build({ entryPoints: [f.entry], outdir: join(f.dir, 'dist'), bundle: true, write: false, format: 'esm', logLevel: 'silent', alias: { '@getforma/core': resolve('../core/src/index.ts') }, plugins: [formaSsrPlugin({ page: 'home', entryPoint: f.entry, outDir: join(f.dir, 'dist') })] });
    const native = result.outputFiles!.find(output => output.path.endsWith('home.ir'))!;
    expect(Buffer.from(native.contents)).toEqual(Buffer.from(before.binary));
    expect(Buffer.from(generateRealIr(f.entry)!.binary)).toEqual(Buffer.from(before.binary));
    expect(result.outputFiles!.find(output => output.path.endsWith('.js'))!.text).toContain('adoptionConditional');
  });
});
