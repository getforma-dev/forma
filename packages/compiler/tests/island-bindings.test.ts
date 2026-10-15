import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFilePath } from '../src/module-loader';
import { analyzeIslandBindings } from '../src/island-bindings';
import { encodeBindings } from '../src/fmir-contracts';
const head = `import {h,createSignal,createShow,createList} from '@getforma/core';\n`;
const analyze = (body: string, props: string[] = []) => analyzeIslandBindings(head + body, '/page.tsx', 'Counter', { props });
const bytes = (body: string, props: string[] = []) => Buffer.from(encodeBindings('ssr', analyze(body, props).bindings)).toString('hex');
describe('component binding identity extraction', () => {
  it('keeps two prop-seeded signals distinct while aliases resolve to the same getter', () => {
    const result = analyze(`export function Counter(p:{hits?:number}) { const [a,setA]=createSignal(p.hits ?? 42); const [b,setB]=createSignal(p.hits ?? 42); const alias=a; return h('p',null,a,b,alias); }`, ['hits']);
    expect(result.bindings.map(x => x.kind)).toEqual(['signal', 'signal', 'text', 'text', 'text']);
    expect(result.bindings.slice(2).map(x => (x as any).value)).toEqual([{kind:'signal',id:0,path:[]},{kind:'signal',id:1,path:[]},{kind:'signal',id:0,path:[]}]);
    expect(result.locals.map(x => [x.getter, x.setter, x.ordinal])).toEqual([['a','setA',0],['b','setB',1]]);
  });
  it('preserves actual module captures and excludes unused globals and event-only reads', () => {
    const result = analyze(`const [a,setA]=createSignal(1); const [b,setB]=createSignal(1); const [unused,setUnused]=createSignal(arbitrary()); export function Counter(){return h('button',{onClick:()=>setUnused(9)},a,b,a);}`);
    expect(result.bindings.map(x=>x.kind)).toEqual(['capture','capture','text','text','text']);
    expect(result.captures.map(x=>x.ordinal)).toEqual([0,1]);
    expect(result.locals).toHaveLength(0);
  });
  it('resolves imported aliases and re-exports to one captured declaration', () => {
    const files: Record<string,string> = {
      '/signals.ts': head + `export const [count,setCount]=createSignal({items:[1,null],ready:true});`,
      '/barrel.ts': `export {count as value} from './signals';`,
    };
    const result = analyzeIslandBindings(head + `import {value as left,value as right} from './barrel'; export function Counter(){return h('p',null,left,right);}`, '/page.tsx', 'Counter', {
      props: [], loadModule: (_from, path) => { const file = path === './barrel' ? '/barrel.ts' : '/signals.ts'; return {path:file, source:files[file]!}; },
    });
    expect(result.bindings.map(x=>x.kind)).toEqual(['capture','text','text']);
    expect((result.bindings[0] as any).value).toEqual({items:[1,null],ready:true});
    expect((result.bindings[1] as any).value).toEqual((result.bindings[2] as any).value);
  });
  it('tracks row paths and inlines ordinary helpers but records registered children separately', () => {
    const result = analyzeIslandBindings(head + `function Label({name}) { return h('b',null,()=>name); } export function Counter(p){return createList(()=>p.rows,r=>r.id,r=>h('li',null,Label({name:r.profile.name}),Badge({label:r.profile.name})));}`, '/page.ts', 'Counter', {
      props:['rows'], islands: new Set(['Badge']), childFields: () => [{name:'label', optional:false}],
    });
    expect(result.bindings).toEqual([{kind:'list',value:{kind:'prop',path:['rows']},key:['id'],body:[
      {kind:'text',value:{kind:'row',id:0,path:['profile','name']}},
      {kind:'child',name:'Badge',fields:[{name:'label',value:{kind:'row',id:0,path:['profile','name']}}]},
    ]}]);
  });
  it('includes both conditional branches and preserves branch-local signal identity', () => {
    const result = analyze(`export function Counter(p){return createShow(()=>p.ok,()=>{const [n,setN]=createSignal(1);return h('p',null,n);},()=>{const [n,setN]=createSignal(2);return h('p',null,n);});}`, ['ok']);
    expect((result.bindings[0] as any).then[0].value).toEqual({kind:'constant',value:1});
    expect((result.bindings[0] as any).else[1].value).toEqual({kind:'signal',id:1,path:[]});
    expect(() => encodeBindings('ssr', result.bindings)).not.toThrow();
  });
  it('extracts equivalent JSX and h bindings without hashing static markup or event bodies', () => {
    const jsx = `export function Counter(p){const [n,setN]=createSignal(1);return <article title={()=>p.title} onClick={()=>setN(2)}>static{n}</article>;}`;
    const h = `export function Counter(p){const [n,setN]=createSignal(1);return h('aside',{title:()=>p.title,onClick:()=>setN(20)},'different',n);}`;
    expect(bytes(jsx,['title'])).toBe(bytes(h,['title']));
    expect(bytes(h,['title'])).not.toBe(bytes(h.replace('title:()', 'class:()'),['title']));
  });
  it('refuses unsafe source integer literals before rounding and unsupported native captures', () => {
    for(const expression of ['9007199254740993','0x20000000000001','123n','external()']) {
      expect(()=>analyze(`const [count,setCount]=createSignal(${expression});export function Counter(){return h('p',null,count);}`)).toThrow(/BUILD-610/);
    }
    expect(()=>analyze(`let [count,setCount]=createSignal(1);count=other;export function Counter(){return h('p',null,count);}`)).toThrow(/reassigned/);
    expect(()=>analyze(`export function Counter(p){return h('p',null,()=>Number(p.text));}`,['text'])).toThrow(/BUILD-610/);
  });
  it('follows lexical shadowing and refuses reassigned aliases rather than stale seeds', () => {
    expect(()=>analyze(`export function Counter(){const [a,setA]=createSignal(1);let alias=a;alias=unknown;return h('p',null,alias);}`)).toThrow(/BUILD-610/);
    const result = analyze(`const [n,setN]=createSignal(9);export function Counter(){const [n,setLocal]=createSignal(1);return h('p',null,n);}`);
    expect(result.captures).toHaveLength(0);
    expect(result.bindings.map(x=>x.kind)).toEqual(['signal','text']);
  });
  it('leaves arbitrary browserOnly bodies outside native binding grammar', () => {
    const result = analyzeIslandBindings(`export function Counter(p){const [n,s]=window.runtime(p);return arbitrary(n);}`, '/browser.ts', 'Counter', {props:['title'],mode:'browserOnly'});
    expect(result.bindings).toEqual([]);
    expect(result.locals).toEqual([]);
  });
  it('resolves parameter object aliases and retains existing closed template defaults', () => {
    const result = analyze('const INITIAL=`hello`; export function Counter(p){const alias=p;const [s,setS]=createSignal(INITIAL);return h("p",null,()=>alias.title,s);}', ['title']);
    expect((result.bindings[0] as any).value).toEqual({kind:'constant',value:'hello'});
    expect((result.bindings[1] as any).value).toEqual({kind:'prop',path:['title']});
  });
  it('does not admit computed declared values through a local seeded signal', () => {
    expect(()=>analyze('export function Counter(p){const [s,setS]=createSignal(p.count);return h("p",null,()=>s()+1);}', ['count'])).toThrow(/computed declared/);
    expect(()=>analyze('export function Counter(p){return h("p",null,()=>!p.ok);}', ['ok'])).toThrow(/computed declared/);
    expect(()=>analyze('export function Counter(){const [s,setS]=createSignal(1);return h("p",null,()=>s()+1);}')).not.toThrow();
  });
  it('assigns captures by canonical child field use and omits unread helper inputs', () => {
    const source = head + 'const [a,setA]=createSignal(1);const [b,setB]=createSignal(2);function Label(p){return h("p",null,p.used);}export function Counter(){return h("div",null,Label({unused:b,used:a}),Badge({z:a,a:b}));}';
    const result = analyzeIslandBindings(source, '/page.ts', 'Counter', {props:[],islands:new Set(['Badge']),childFields:()=>[{name:'z',optional:false},{name:'a',optional:false}]});
    expect(result.bindings.slice(0,2)).toEqual([{kind:'capture',value:1},{kind:'capture',value:2}]);
    expect((result.bindings[3] as any).fields).toEqual([{name:'a',value:{kind:'capture',id:1,path:[]}},{name:'z',value:{kind:'capture',id:0,path:[]}}]);
    const unused = analyze('const [a,s]=createSignal(1);const [unused,t]=createSignal(arbitrary());function Label(p){return h("p",null,p.used);}export function Counter(){return Label({unused,used:a});}');
    expect(unused.captures).toHaveLength(1);
  });
  it('distinguishes callable getter aliases and zero-argument helpers from plain props', () => {
    const result = analyze('function Label(){return h("b",null,"fixed");}export function Counter(){const [n,setN]=createSignal(1);const alias=n;return h("p",null,()=>alias(),Label());}');
    expect(result.bindings.map(x=>x.kind)).toEqual(['signal','text']);
    expect(()=>analyze('export function Counter({title}){return h("p",null,()=>title());}',['title'])).toThrow(/actual signal getter/);
    const imported = analyzeIslandBindings(head + 'import {Label} from "./label";export function Counter(){return Label();}', '/page.ts', 'Counter', {props:[],loadModule:()=>({path:'/label.ts',source:head+'export function Label(){const [n,setN]=createSignal(1);return h("p",null,n);}'})});
    expect(imported.bindings.map(x=>x.kind)).toEqual(['signal','text']);
  });
  it('preserves the original imported table corpus as static expanded markup', () => {
    const file = fileURLToPath(new URL('./fixtures/ir-corpus/imported-const-table/picker.ts', import.meta.url));
    const result = analyzeIslandBindings(readFileSync(file, 'utf8'), file, 'KeyPicker', {props:[], loadModule:(from,specifier)=>{
      const target = resolveFilePath(dirname(from), specifier);
      return target ? {path:target,source:readFileSync(target,'utf8')} : null;
    }});
    expect(result.bindings).toEqual([{kind:'capture',value:'A'},{kind:'attribute',name:'data-selected',value:{kind:'capture',id:0,path:[]}}]);
    expect(result.captures).toHaveLength(1);
  });
  it('uses lexical component identity when a local helper shadows a registered spelling', () => {
    const source = head + 'export function Counter(){function Badge(){const [n,s]=createSignal(1);return h("b",null,n);}return Badge();}';
    const result = analyzeIslandBindings(source, '/page.ts', 'Counter', {props:[],islands:new Set(['Badge']),childFields:()=>{throw new Error('shadow must not consult registry');}});
    expect(result.bindings.map(x=>x.kind)).toEqual(['signal','text']);
    const other = analyzeIslandBindings(head+'function Badge(){return h("b",null,"static");}export function Counter(){return Badge();}', '/other.ts', 'Counter', {props:[],islands:new Set(['Badge']),registration:()=>undefined});
    expect(other.bindings).toEqual([]);
  });
  it('refuses pre-return writes while allowing event handlers and unrelated registered effects', () => {
    for (const statement of ['setN(2);','const alias=setN;alias(2);','external();','const ignored=setN(2);','const ignored=external();','const ignored=setN?.(2);','const ignored=setN`tag`;']) {
      expect(()=>analyze(`export function Counter(){const [n,setN]=createSignal(1);${statement}return h('p',null,n);}`)).toThrow(/pre-return/);
    }
    const effects = `import {createEffect} from '@getforma/core';`;
    expect(()=>analyze(effects+`export function Counter(){const [n,setN]=createSignal(1);createEffect(()=>setN(2));return h('p',null,n);}`)).toThrow(/effect writes/);
    expect(()=>analyze(effects+`export function Counter(p){createEffect(()=>{p.title='changed';});return h('p',null,p.title);}`,['title'])).toThrow(/effect mutates/);
    expect(()=>analyze(effects+`export function Counter(){const [n,setN]=createSignal(1);createEffect(()=>{n();});return h('button',{onClick:()=>setN(2)},n);}`)).not.toThrow();
    expect(()=>analyze(effects+`export function Counter(){const [n,setN]=createSignal(1);function bump(){setN(2);}createEffect(()=>bump());return h('p',null,n);}`)).toThrow(/pre-return effect call/);
    expect(()=>analyze(effects+`export function Counter(){const [n,setN]=createSignal(1);function bump(){setN(2);}createEffect(bump);return h('p',null,n);}`)).toThrow(/literal callback/);
    expect(()=>analyze(effects+`const [n,setN]=createSignal(1);class Bump{constructor(){setN(2);}}export function Counter(){createEffect(()=>new Bump());return h('p',null,n);}`)).toThrow(/pre-return effect execution/);
    expect(()=>analyze(`import {onCleanup} from '@getforma/core';export function Counter(){const [n,setN]=createSignal(1);function dispose(){setN(2);}onCleanup(dispose);return h('button',{onClick:()=>setN?.(3)},n);}`)).not.toThrow();
    const modules: Record<string,string> = {
      './store': head+'export const [count,setCount]=createSignal(1);',
      './barrel': 'export {setCount as update} from "./store";',
    };
    expect(()=>analyzeIslandBindings(head+effects+'import {update} from "./barrel";export function Counter(){createEffect(()=>update(2));return h("p",null,"fixed");}', '/page.ts', 'Counter', {
      props:[],loadModule:(_from,specifier)=>({path:specifier,source:modules[specifier]!}),
    })).toThrow(/effect writes/);
  });
});
