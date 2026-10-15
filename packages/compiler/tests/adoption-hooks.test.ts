import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from '@babel/parser';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createIslandRegistry, type IslandRegistry } from '../src/island-registry';
import { collectAdoptionEdits } from '../src/adoption-hooks';
import { applySourceEdits } from '../src/source-edits';
import { SourceSnapshot, withSourceSnapshot } from '../src/source-snapshot';
import { canonicalIslandSchema, encodeBindings } from '../src/fmir-contracts';

const directories: string[]=[];
afterEach(()=>{for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
const prelude=`import { h, createSignal, createShow, createList, activateIslands } from '@getforma/core';\n`;
function fixture(body:string, others:Record<string,string>={}, names='Counter') {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'forma-adoption-hooks-')));directories.push(dir);
  const entry=join(dir,'entry.tsx'),source=prelude+body+`\nexport function registrations(){ activateIslands({${names}}); }\n`;
  const sources=new Map([[entry,source]]);
  for(const [name,text] of Object.entries(others))sources.set(join(dir,name),text);
  for(const [file,text] of sources)writeFileSync(file,text);
  const registry=createIslandRegistry(entry);
  const edits=collectAdoptionEdits(registry);
  const transformed=new Map([...sources].map(([file,text])=>[file,applySourceEdits(text,edits.get(file)??[])]));
  for(const text of transformed.values())parse(text,{sourceType:'module',plugins:['typescript','jsx']});
  return {dir,entry,source,sources,registry,edits,transformed,text:transformed.get(entry)!};
}
const writableCount=(text:string)=>[...text.matchAll(/__forma_adoptWritable\w*\(/g)].length;
async function runtime(f:ReturnType<typeof fixture>) {
  const root=resolve('../core/src'), wrapper=join(f.dir,'runtime.ts');
  writeFileSync(wrapper,`export * from './entry';\nexport { withAdoptionSink } from ${JSON.stringify(join(root,'reactive/adoption-hooks.ts'))};\nexport { withAdoptionDescription } from ${JSON.stringify(join(root,'dom/adoption-description.ts'))};`);
  const result=await build({entryPoints:[wrapper],bundle:true,write:false,platform:'node',format:'cjs',target:'node20',alias:{'@getforma/core':join(root,'index.ts')},plugins:[{name:'original-adoption-hooks',setup(plugin){plugin.onLoad({filter:/\.[jt]sx?$/},args=>{const contents=f.transformed.get(args.path);return contents===undefined?undefined:{contents,loader:'tsx'};});}}]});
  const output={exports:{} as any};runInNewContext(result.outputFiles[0]!.text,{module:output,exports:output.exports,console,queueMicrotask,setTimeout,clearTimeout,TextEncoder,TextDecoder,require:()=>{throw new Error('unexpected runtime require');}});return output.exports;
}

describe('original-source adoption hooks',()=>{
  it('keeps original canonical schema and binding bytes, while retaining initializer annotations',()=>{
    const f=fixture(`export function Counter(p:{count:number}) { const [count,setCount]=createSignal<number>(p.count); return h('input',{value:count}); }`);
    const island=f.registry.entries()[0]!.island;
    const before={schema:canonicalIslandSchema(island.declared.schema,0),bindings:Buffer.from(encodeBindings('ssr',island.analyze().bindings))};
    collectAdoptionEdits(f.registry);
    expect(canonicalIslandSchema(island.declared.schema,0)).toEqual(before.schema);
    expect(Buffer.from(encodeBindings('ssr',island.analyze().bindings))).toEqual(before.bindings);
    expect(f.text).toContain('createSignal<number>(p.count)');expect(writableCount(f.text)).toBe(1);
    expect(f.text).toMatch(/value:__forma_adoptWritable\(count, count, "number",/);
  });
  it('preserves actual distinct built-in tuples and one getter read for aliases and inline closures',async()=>{
    const f=fixture(`export function Counter(p:{count:number}) { const [a]=createSignal(p.count); const [b,setB]=createSignal(p.count); const alias=a; return h('div',null,h('input',{value:alias}),h('input',{value:()=>b()})); }`);
    const r=await runtime(f),captured:any[]=[],enrolled:any[]=[],reads:any[]=[];
    const sink={capture:(...pair:any[])=>captured.push(pair),enroll:(_site:number,pair:any)=>enrolled.push(pair),writable:(read:any,get:any,codec:string)=>{reads.push({read,get,codec});return read;}};
    const value=r.withAdoptionSink(sink,()=>r.withAdoptionDescription(()=>r.Counter({count:7})));
    expect(captured).toHaveLength(2);expect(enrolled).toHaveLength(2);expect(reads).toHaveLength(2);
    for(let i=0;i<2;i++){expect(enrolled[i][0]).toBe(captured[i][0]);expect(enrolled[i][1]).toBe(captured[i][1]);expect(reads[i].get).toBe(enrolled[i][0]);expect(reads[i].codec).toBe('number');}
    expect(enrolled[0][0]).not.toBe(enrolled[1][0]);expect(value.children.map((c:any)=>c.props.value())).toEqual([7,7]);
    enrolled[0][1](9);expect(value.children.map((c:any)=>c.props.value())).toEqual([9,7]);
  });
  it('collects imported helper hooks and preserves two executions of one declaration',async()=>{
    const f=fixture(`import {Field} from './field'; export function Counter(p:{left:number;right:number}) { return h('div',null,Field({initial:p.left}),Field({initial:p.right})); }`,{'field.ts':prelude+`export function Field(p){const [value,setValue]=createSignal(p.initial);return h('input',{value});}`});
    expect(f.edits.has(join(f.dir,'field.ts'))).toBe(true);expect(writableCount(f.transformed.get(join(f.dir,'field.ts'))!)).toBe(1);
    const r=await runtime(f),pairs:any[]=[],reads:any[]=[];
    const result=r.withAdoptionSink({enroll:(_s:any,p:any)=>pairs.push(p),writable:(read:any,get:any)=>{reads.push(get);return read;}},()=>r.withAdoptionDescription(()=>r.Counter({left:1,right:2})));
    expect(pairs).toHaveLength(2);expect(pairs[0][0]).not.toBe(pairs[1][0]);expect(reads).toEqual(pairs.map(p=>p[0]));expect(result.children.map((c:any)=>c.props.value())).toEqual([1,2]);
  });
  it('keeps conflicting shared helper codecs unseedable instead of choosing the last traversal',()=>{
    const f=fixture(`function Field(p){const [value]=createSignal(p.initial);return h('input',{value});} export function Counter(p:{a:string;b:number}){return h('div',null,Field({initial:p.a}),Field({initial:p.b}));}`);
    expect(writableCount(f.text)).toBe(0);expect(f.text).toContain('__forma_adoptSignal(');
  });
  it('leaves captures, eager values, named forwarders and projected/computed reads without setter authority',()=>{
    const f=fixture(`const [global,setGlobal]=createSignal(1); export function Counter(){const [n,setN]=createSignal(2);const forward=()=>n();const eager=n();return h('div',null,h('input',{value:global}),h('input',{value:forward}),h('input',{value:eager}),h('input',{value:()=>n()+1}));}`);
    expect(writableCount(f.text)).toBe(0);expect(f.text.match(/__forma_adoptSignal\(/g)).toHaveLength(1);
  });
  it('retains optional, enum and narrow setter contracts instead of inferring from one value',()=>{
    const f=fixture(`export function Counter(p:{optional?:string;choice:'a'|'b'}){const [a]=createSignal(p.optional);const [b]=createSignal(p.choice);const [c]=createSignal<'x'|'y'>('x');const [d]=createSignal('x' as const);const [e]=createSignal<string|null>('x');const [f]=createSignal(p.optional ?? '');return h('div',null,h('input',{value:a}),h('input',{value:b}),h('input',{value:c}),h('input',{value:d}),h('input',{value:e}),h('input',{value:f}));}`);
    expect(writableCount(f.text)).toBe(1);expect(f.text).toMatch(/__forma_adoptWritable\(f, f, "string"/);expect(f.text).toContain("createSignal<'x'|'y'>('x')");
  });
  it('proves dense string arrays only, with explicit empty-array annotation retained',()=>{
    const f=fixture(`export function Counter(p:{options:string[]}){const [a]=createSignal(p.options);const [b]=createSignal<string[]>([]);const [c]=createSignal([]);return h('div',null,h('select',{value:a}),h('select',{value:b}),h('select',{value:c}));}`);
    expect(writableCount(f.text)).toBe(2);expect(f.text).toContain('createSignal<string[]>([])');
  });
  it('retains the original caller getter association through helper props, including shorthand',async()=>{
    const f=fixture(`function Field(p){return h('input',{value:p.value});} export function Counter(p:{count:number}){const [value]=createSignal(p.count);return Field({value});}`);
    expect(f.text).toMatch(/Field\(\{value: __forma_adoptWritable\(value, value, "number"/);
    const r=await runtime(f),pairs:any[]=[],reads:any[]=[];
    const result=r.withAdoptionSink({enroll:(_s:any,p:any)=>pairs.push(p),writable:(read:any,get:any)=>{reads.push(get);return read;}},()=>r.withAdoptionDescription(()=>r.Counter({count:8})));
    expect(reads).toEqual([pairs[0][0]]);expect(result.props.value()).toBe(8);
  });
  it('keeps direct registered child calls lazy with original argument count and props',async()=>{
    const f=fixture(`export function Child(p:{title?:string}){return 'child';} export function Counter(p:{title:string}){return h('div',null,Child(),Child({title:p.title}));}` ,{},'Counter,Child');
    expect(f.text.match(/__forma_adoptChild\(/g)).toHaveLength(2);
    const r=await runtime(f),result=r.withAdoptionDescription(()=>r.Counter({title:'original'}));
    expect(result.children.map((c:any)=>c.type)).toEqual(['component','component']);expect(result.children.map((c:any)=>c.component)).toEqual([r.Child,r.Child]);
    expect(result.children.map((c:any)=>c.args)).toEqual([[],[{title:'original'}]]);
    expect(result.children.map((c:any)=>Reflect.apply(c.component,c.receiver,c.args))).toEqual(['child','child']);
  });
  it('keeps per-instance tuples inside deferred branches and repeated list rows',async()=>{
    const f=fixture(`export function Counter(p:{show:boolean;rows:{id:string;value:string}[]}){return h('div',null,createShow(()=>p.show,()=>{const [value]=createSignal('branch');return h('input',{value});}),createList(()=>p.rows,row=>row.id,row=>{const [value]=createSignal(row.value);return h('input',{value});}));}`);
    expect(writableCount(f.text)).toBe(2);
    const r=await runtime(f),pairs:any[]=[],reads:any[]=[];
    const sink={enroll:(_s:any,p:any)=>pairs.push(p),writable:(read:any,get:any)=>{reads.push(get);return read;}};
    const result=r.withAdoptionSink(sink,()=>r.withAdoptionDescription(()=>r.Counter({show:true,rows:[{id:'a',value:'one'},{id:'b',value:'two'}]})));
    expect(pairs).toEqual([]);
    const [show,list]=result.children;
    const prepared=r.withAdoptionSink(sink,()=>r.withAdoptionDescription(()=>[show.whenTrue(),...list.items().map((row:any)=>list.renderFn(row,()=>0))]));
    expect(pairs).toHaveLength(3);expect(new Set(pairs.map(pair=>pair[0])).size).toBe(3);expect(reads).toEqual(pairs.map(pair=>pair[0]));expect(prepared.map((item:any)=>item.props.value())).toEqual(['branch','one','two']);
  });
  it('does not recover broad authority through a second signal or a narrowed getter annotation',()=>{
    const f=fixture(`export function Counter(){const [n]=createSignal<'a'|'b'>('a');const [copy]=createSignal(n());const alias:()=> 'a'|'b'=n;return h('div',null,h('input',{value:copy}),h('input',{value:alias}));}`);
    expect(writableCount(f.text)).toBe(0);
  });
  it('preserves parenthesized direct child callees and original nested argument expressions',async()=>{
    const f=fixture(`export function Child(p:{title:string}){return 'child';} export function Counter(p:{title:string}){return ((Child))({title:p.title});}`,{},'Counter,Child');
    const r=await runtime(f),result=r.withAdoptionDescription(()=>r.Counter({title:'original'}));expect(result.component).toBe(r.Child);expect(result.args).toEqual([{title:'original'}]);
  });
  it('preserves direct child type arguments without changing runtime function identity',async()=>{
    const f=fixture(`export function Child<T>(p:{title:string}){return 'child';} export function Counter(p:{title:string}){return Child<string>({title:p.title});}`,{},'Counter,Child');
    expect(f.text).toContain('Child<string>, [');
    const r=await runtime(f),result=r.withAdoptionDescription(()=>r.Counter({title:'original'}));expect(result.component).toBe(r.Child);expect(result.args).toEqual([{title:'original'}]);
  });
  it('retains outer tuple casts and lexical shadows without broadening their writable proof',()=>{
    const f=fixture(`const [value,setGlobal]=createSignal(90); export function Counter(){const [value]=createSignal(1) as [()=>number,(n:number)=>void];return h('input',{value});}`);
    expect(f.text).toMatch(/__forma_adoptSignal\(\d+, createSignal\(1\)\) as \[\(\)=>number/);expect(writableCount(f.text)).toBe(0);
    const local=fixture(`const [value,setGlobal]=createSignal(90); export function Counter(){const [value]=createSignal(1);return h('input',{value});}`);
    expect(writableCount(local.text)).toBe(1);expect(local.text).toContain("const [value,setGlobal]=createSignal(90)");
  });
  it('does not bless changed files or incompatible original snapshots during collection',()=>{
    const f=fixture(`export function Counter(){const [value]=createSignal('before');return h('input',{value});}`);
    const snapshot=new SourceSnapshot();
    const registry=withSourceSnapshot(snapshot,()=>createIslandRegistry(f.entry));
    withSourceSnapshot(snapshot,()=>registry.entries()[0]!.island.analyze());
    writeFileSync(f.entry,f.source.replace("'before'","'after'"));
    const edits=withSourceSnapshot(snapshot,()=>collectAdoptionEdits(registry));
    expect(applySourceEdits(f.source,edits.get(f.entry)!)).toContain("createSignal('before')");expect(snapshot.unchanged()).toBe(false);
    const changed=createIslandRegistry(f.entry);
    expect(()=>collectAdoptionEdits([registry,changed])).toThrow('source snapshots disagree');
  });
  it('unions split-entry hooks once per shared module with hygienic imports and exact original snapshots',()=>{
    const f=fixture(`import {One} from './shared';export {One}; export function Counter(){return One();}`,{'shared.ts':prelude+`const __forma_adoptSignal=1;export function One(){const [value]=createSignal('one');return h('input',{value});}export function Two(){const [value]=createSignal('two');return h('input',{value});}`},'One');
    const second=join(f.dir,'second.ts');writeFileSync(second,prelude+`import {Two} from './shared';activateIslands({Two});`);
    const registries=[f.registry,createIslandRegistry(second),f.registry];const edits=collectAdoptionEdits(registries),file=join(f.dir,'shared.ts'),text=applySourceEdits(f.sources.get(file)!,edits.get(file)!);
    parse(text,{sourceType:'module',plugins:['typescript','jsx']});expect(text.match(/import \{ __adoptionSignal/g)).toHaveLength(1);expect(text.match(/__forma_adoptSignal_\(/g)).toHaveLength(2);expect(writableCount(text)).toBe(2);
  });
});
