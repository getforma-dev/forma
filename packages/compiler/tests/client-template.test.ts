import { afterEach, describe, expect, it } from 'vitest';
import { build, transform, type Plugin } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formaClientPlugin, transformClientTemplates } from '../src/client-template';
import { formaSsrPlugin, generateRealIr } from '../src/esbuild-ssr-plugin';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const prefix = 'import {h,createList} from "@getforma/core";';
const list = (tree: string) => `createList(()=>[{id:1}], item=>item.id, item=>(${tree}))`;
const stub: Plugin = { name: 'compiled-contract-stub', setup(b) {
  b.onResolve({ filter: /^@getforma\/core(?:\/compiled)?$/ }, a => ({ path: a.path, namespace: 'contract' }));
  b.onLoad({ filter: /.*/, namespace: 'contract' }, () => ({ loader: 'js', contents: `
    export function h(tag,props,...children){
      if(globalThis.executeReaders){props=Object.fromEntries(Object.entries(props??{}).map(([key,value])=>[key,!key.startsWith('on')&&typeof value==='function'?value():value]));children=children.map(value=>typeof value==='function'?value():value)}
      return {tag,props,children};
    }
    export function trustedHtml(value){globalThis.mints=(globalThis.mints??0)+1;return value}
    export function __createCompiledTemplate(markup,bindings){
      const factory={bindings};(globalThis.factories??=[]).push(factory);
      return initialize=>{
        if(globalThis.fallback)return initialize();
        const html=factory.html??=markup(),values=[],calls=[],bound=[];
        initialize((index,value)=>{values[index]=value;calls.push(index);bound[index]=globalThis.executeReaders&&bindings[index][1]!==2&&typeof value==='function'?value():value});
        return {html,bindings,values,calls,bound};
      };
    }
    export function createList(source,key,render){return (render??key)(source()[0])}
    export const createSignal=value=>[()=>value,next=>{value=next}];
    export const __adoptionSignal=(_site,tuple)=>tuple;export const __adoptionWritable=reader=>reader;
    export function activateIslands(registry){globalThis.registry=registry}
    export function __islandRegistration(component,metadata){component.metadata=metadata;return component}
    export function mount(fn){globalThis.mounted=fn()}
  ` }));
} };
async function execute(source: string, flags = {}): Promise<any> {
  const result = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsxFactory: 'h', jsxFragment: 'Fragment', plugins: [stub], logLevel: 'silent' });
  const globalThis: any = {...flags}; runInNewContext(result.outputFiles![0]!.text, { globalThis }); return globalThis;
}
const lower = (source: string) => transformClientTemplates(source, { factory: 'h' });

describe('closed repeated client JSX templates', () => {
  it('lowers a direct keyed row to a lazy trusted template with explicit binding paths', async () => {
    const original = `${prefix}
      const data={id:7,selected:false,label:()=>"hello",select:id=>globalThis.selected=id,remove:id=>globalThis.removed=id};
      globalThis.row=createList(()=>[data], row=>row.id, row=><tr class={() => row.selected ? 'danger' : ''}>
        <td class="col-id">{row.id}</td><td><a class="lbl" onClick={() => row.select(row.id)}>{() => row.label()}</a></td>
        <td><a class="remove" onClick={() => row.remove(row.id)}>x</a></td></tr>);`;
    const emitted = lower(original), result = await execute(emitted);
    expect(emitted).toContain("from '@getforma/core/compiled'");
    expect(emitted).toContain('() => __formaTrustedHtml(');
    expect(result.factories).toHaveLength(1); expect(result.mints).toBe(1);
    expect(result.row.html).toBe('<tr><td class="col-id"></td><td><a class="lbl"></a></td><td><a class="remove">x</a></td></tr>');
    expect(result.row.bindings).toEqual([[[],0,'class'],[[0],1],[[1,0],2,'onClick'],[[1,0],1],[[2,0],2,'onClick']]);
    expect(result.row.calls).toEqual([1,2,3,4,0]);
    expect(result.row.values[1]).toBe(7);
    result.row.values[2](); result.row.values[4]();
    expect([result.selected,result.removed]).toEqual([7,7]);
    const fallback = await execute(emitted, {fallback:true});
    expect(fallback.mints).toBeUndefined(); expect(fallback.row.tag).toBe('tr');
    expect(fallback.row.children[1].children[0].children[0]()).toBe('hello');
  });
  it('interleaves sibling readers, later expressions and parent initialization like original JSX', async () => {
    const source = `${prefix}let x=0;globalThis.trace=[];const read=x=>(globalThis.trace.push(x),x);
      globalThis.row=${list(`<div class={read('outer expression')}><span class={()=>read('inner reader')}>{()=>{x=1;return read('first child reader')}}</span><span>{read(x)}</span></div>`)};`;
    const original = await execute(source,{executeReaders:true});
    const compiled = await execute(lower(source),{executeReaders:true});
    const fallback = await execute(lower(source),{executeReaders:true,fallback:true});
    expect(compiled.trace).toEqual(['outer expression','inner reader','first child reader',1]);
    expect(compiled.trace).toEqual(original.trace); expect(fallback.trace).toEqual(original.trace);
    expect(compiled.row.bound[3]).toBe(1);
    expect(compiled.row.calls).toEqual([1,2,3,0]);
  });
  it('captures a node child expression before running that same node prop reader', async () => {
    const source=`${prefix}let x=0;globalThis.row=${list('<div><span class={()=>{x=1;return "x"}}>{x}</span></div>')};`;
    const original=await execute(source,{executeReaders:true}),compiled=await execute(lower(source),{executeReaders:true});
    expect(original.row.children[0].children).toEqual([0]); expect(compiled.row.bound).toEqual(['x',0]);
  });
  it('does not evaluate a later sibling after an earlier initial reader throws', async () => {
    const source=`${prefix}const failure=new Error('initial reader');globalThis.trace=[];
      try{globalThis.row=${list('<div><span>{()=>{globalThis.trace.push("first");throw failure}}</span><span>{globalThis.trace.push("later")}</span></div>')}}catch(error){globalThis.same=error===failure}`;
    for(const [input,flags] of [[source,{executeReaders:true}],[lower(source),{executeReaders:true}],[lower(source),{executeReaders:true,fallback:true}]] as const){
      const result=await execute(input,flags);expect(result.trace).toEqual(['first']);expect(result.same).toBe(true);
    }
  });
  it('escapes compile-time text/attributes and coalesces adjacent static text before binding paths', async () => {
    const source = `${prefix}globalThis.row=${list(`<div title={'<&"'}>a{'b'}<span onClick={()=>0}>{()=>1}</span>{'<&'}</div>`)};`;
    const result = await execute(lower(source));
    expect(result.row.html).toBe('<div title="&lt;&amp;&quot;">ab<span></span>&lt;&amp;</div>');
    expect(result.row.bindings).toEqual([[[1],2,'onClick'],[[1],1]]);
  });
  it.each([
    '<div ref={capture}><span /></div>', '<div style={{color:"red"}}><span /></div>',
    '<div {...props}><span /></div>', '<div class="a" className="b"><span /></div>',
    '<div dangerouslySetInnerHTML={raw}><span /></div>', '<div><a href={url}/></div>',
    '<div><script /></div>', '<div><custom-element /></div>', '<div><input value={value}/></div>',
    '<h1><h2>nested</h2></h1>', '<p><li>closed paragraph</li></p>', '<a><a>nested</a></a>',
    '<div>prefix{value}<span /></div>', '<div><span onClick={handler}/></div>',
    '<div><span onInput={()=>0}/></div>', '<div title={"\\r"}><span /></div>',
  ])('keeps unsupported row tree on the ordinary factory: %s', tree => {
    const source = `${prefix}const row=${list(tree)};`;
    expect(lower(source)).toBe(source);
  });
  it('does not serialize implicit table bodies or parser-repaired nested button trees', async () => {
    const source = `${prefix}globalThis.row=${list('<table><tr><td>x</td></tr></table>')};`;
    const result = await execute(lower(source));
    expect(result.factories).toHaveLength(1); expect(result.factories[0].html).toBe('<tr><td>x</td></tr>');
    expect(result.row.children[0].html).toBe('<tr><td>x</td></tr>');
    const buttons = `${prefix}const row=${list('<button><button>x</button></button>')};`;
    expect(lower(buttons)).toBe(buttons);
  });
  it('wraps an optimized descendant in an unsupported JSX parent or fragment as an expression', async () => {
    const source = `${prefix}globalThis.row=${list('<section><input value={3}/><button onClick={()=>0}><span>append</span></button></section>')};`;
    const result = await execute(lower(source));
    expect(result.factories).toHaveLength(1); expect(result.row.children[0].tag).toBe('input');
    expect(result.row.children[1].html).toBe('<button><span>append</span></button>');
    const emitted = lower(`${prefix}const Fragment=Symbol();globalThis.row=${list('<><div><span/></div></>')};`);
    expect(emitted).toContain('<>{__formaTemplate(');
    expect((await execute(emitted)).row.children[0].html).toBe('<div><span></span></div>');
  });
  it('recognizes only direct original-core render callbacks and both overload positions', () => {
    for(const call of ['createList(rows,item=><div><span>{item}</span></div>)','createList(rows,key,function(item){return <div><span>{item}</span></div>},options)'])
      expect(lower(`${prefix}${call}`)).toContain('@getforma/core/compiled');
    const alias='import {h,createList as rows} from "@getforma/core";rows(source,key,item=><div><span>{item}</span></div>);';
    expect(lower(alias)).toContain('@getforma/core/compiled');
    for(const source of [
      `${prefix}const view=()=> <div><span /></div>;`,
      `${prefix}const row=item=><div><span>{item}</span></div>;createList(source,key,row);`,
      `${prefix}function view(createList){return createList(source,key,item=><div><span>{item}</span></div>)}`,
      `${prefix}createList(source,key,item=>{const nested=()=> <div><span /></div>;return nested()});`,
      `${prefix}other(source,key,item=><div><span>{item}</span></div>);`,
      `${prefix}createList(source,item=><div><span>{item}</span></div>,render);`,
      `${prefix}createList(source,key,async item=><div><span>{await item}</span></div>);`,
      `${prefix}createList(source,key,function*(item){return <div><span>{yield item}</span></div>});`,
      `${prefix}createList(...args,item=><div><span>{item}</span></div>);`,
    ]) expect(lower(source)).toBe(source);
  });
  it('leaves other JSX runtimes, unrelated/shadowed factories and namespace pragmas alone', () => {
    for (const source of [
      'const h=other;const createList=other;'+list('<div><span /></div>'),
      `${prefix}function view(h){return ${list('<div><span /></div>')}}`,
      `${prefix}/** @jsx custom */${list('<div><span /></div>')}`,
      `${prefix}/** @jsxRuntime automatic */${list('<div><span /></div>')}`,
    ]) expect(lower(source)).toBe(source);
    const source = `${prefix}${list('<div><span /></div>')}`;
    expect(transformClientTemplates(source, { runtime: 'automatic' })).toBe(source);
  });
  it('retains deferred async handler bodies and Node/array readers without eagerly calling them', async () => {
    const source = `${prefix}globalThis.calls=0;const make=()=>{globalThis.calls++;return ['a','b']};globalThis.row=${list('<div><span onClick={async()=>await 1}>{make}</span></div>')};`;
    const result = await execute(lower(source));
    expect(result.calls).toBe(0); expect(result.row.bindings).toEqual([[[0],2,'onClick'],[[0],1]]);
    expect(result.row.values[1]()).toEqual(['a','b']); expect(result.calls).toBe(1);
  });
  it('uses collision-free hoists and leaves unused factories tree-shakeable', async () => {
    const source = `${prefix}const __formaCreateTemplate=1,__formaTemplate=2,__formaBind=3;export function unused(){return ${list('<div><span /></div>')}};globalThis.sum=__formaCreateTemplate+__formaTemplate+__formaBind;`;
    const emitted = lower(source); expect(emitted).toContain('__formaTemplate_'); expect(emitted).toContain('/* @__PURE__ */');
    const built = await transform(emitted, { loader:'tsx', jsxFactory:'h' }); expect(built.code).toContain('PURE');
    const result=await execute(emitted);expect(result.sum).toBe(6);expect(result.mints).toBeUndefined();
  });
  it('composes original native/adoption edits before repeated-row lowering without changing FMIR', async () => {
    const root = mkdtempSync(join(tmpdir(),'forma-client-native-')); roots.push(root);
    const entry = join(root,'app.tsx'), outdir = join(root,'dist');
    writeFileSync(entry, `import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
      function Counter(p:{count:number;rows:{id:number;label:string}[]}){const[n,setN]=createSignal(p.count);return <section><button onClick={()=>setN(n()+1)}>{n}</button><ul>{createList(()=>p.rows,row=>row.id,row=><li><span>{row.label}</span></li>)}</ul></section>}
      function Page(p:{count:number;rows:{id:number;label:string}[]}){return <main>{Counter({count:p.count,rows:p.rows})}</main>}
      activateIslands({Counter});mount(Page,'#app');`);
    const native = generateRealIr(entry); expect(native).not.toBeNull();
    const result = await build({entryPoints:[entry],outdir,bundle:true,write:false,format:'iife',jsxFactory:'h',logLevel:'silent',plugins:[stub,formaSsrPlugin({page:'app',entryPoint:entry,outDir:outdir}),formaClientPlugin()]});
    expect(result.outputFiles!.find(f=>f.path.endsWith('.ir'))!.contents).toEqual(native!.binary);
    const js = result.outputFiles!.find(f=>f.path.endsWith('.js'))!.text;
    expect(js).toContain('__adoptionSignal'); expect(js).toContain('__createCompiledTemplate');
    const globalThis:any={};runInNewContext(js,{globalThis});
    expect(globalThis.mounted).toBeUndefined();
    const instance=globalThis.registry.Counter({count:3,rows:[{id:1,label:'a'}]});
    expect(instance.tag).toBe('section');expect(instance.children[1].children[0].html).toBe('<li><span></span></li>');
  });
});
