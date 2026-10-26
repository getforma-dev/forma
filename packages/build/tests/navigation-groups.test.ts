import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../src/index';
import type { BuildConfig, NavigationBootstrap } from '../src/index';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); delete (globalThis as any).__navigationGroup; });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-public-navigation-')); roots.push(root);
  const core = join(root, 'node_modules/@getforma/core'); mkdirSync(core, {recursive:true});
  writeFileSync(join(core, 'package.json'), JSON.stringify({name:'@getforma/core',version:'3.1.0',type:'module',exports:'./index.js'}));
  writeFileSync(join(core, 'index.js'), `export function h(){throw Error('rendered during registration')}
    export function mount(){throw Error('mounted during registration')}
    export function activateIslands(){throw Error('activated during registration')}
    export function __islandRegistration(component, metadata){component.metadata=metadata; return component}
    export function __adoptionChild(){}; export function __adoptionConditional(){};
    export function __adoptionSignal(){}; export function __adoptionWritable(){};`);
  writeFileSync(join(root,'shell.ts'), `import {h,mount} from '@getforma/core';
    function Shell(){return h('main', null, h('header',null,'persistent'), h('div',{'data-forma-outlet':'child'}))}
    mount(()=>Shell(),'#app');`);
  writeFileSync(join(root,'shared.ts'), `import {h} from '@getforma/core';
    export function Counter(props:{count:number}){return h('button',null,props.count)}`);
  for(const name of ['a','b']) writeFileSync(join(root,`${name}.ts`), `import {h,mount,activateIslands} from '@getforma/core';
    import {Counter} from './shared';
    function Page(props:{count:number}){return h('section',null,'${name}',Counter({count:props.count}))}
    activateIslands({Counter});mount(()=>Page({count:0}),'#app');`);
  writeFileSync(join(root,'client.ts'), 'export default function initialize(group){globalThis.__navigationGroup=group}');
  const config:BuildConfig = {app:'navigation-test',ssr:true,entryPoints:['shell','a','b'].map(name=>({entry:join(root,`${name}.ts`),outfile:`${name}.js`})),
    routes:{'/shell':{js:['shell'],css:[]},'/a':{js:['a'],css:[]},'/b':{js:['b'],css:[]}},outputDir:join(root,'dist'),
    navigationGroups:[{id:'app',owners:['shell','a','b'],client:join(root,'client.ts')}]};
  return {root,config};
}
it('publishes separately compiled native owners with one closed, integrity-checked initialization artifact', async()=>{
  const {config}=fixture(); const {manifest,sizes}=await build(config); const routes=Object.values(manifest.routes);
  expect(new Set(routes.map(route=>route.ir)).size).toBe(3);
  expect(new Set(routes.map(route=>route.js[0])).size).toBe(1);
  expect(routes.every(route=>route.js.length===1&&!route.modulepreload)).toBe(true);
  expect(manifest.routes['/shell'].navigation).toEqual({group:'app',owner:'shell',outlet:'child'});
  expect(manifest.routes['/a'].navigation).toEqual({group:'app',owner:'a',outlet:null});
  expect(sizes.every(size=>size.class==='navigation-group')).toBe(true);
  const js=readFileSync(join(config.outputDir,routes[0].js[0]));
  expect(manifest.assets[routes[0].js[0]].integrity).toBe(`sha384-${createHash('sha384').update(js).digest('base64')}`);
  expect(readdirSync(config.outputDir).filter(name=>name.endsWith('.js')&&name!=='sw.js')).toEqual(routes[0].js);
  await import(`data:text/javascript;base64,${js.toString('base64')}`);
  const bootstrap:NavigationBootstrap=(globalThis as any).__navigationGroup;
  expect(bootstrap).toMatchObject({app:manifest.app,build:manifest.build,group:'app',owners:['shell','a','b']});
  expect(Object.keys(bootstrap.registrations)).toEqual(['Counter']);
  expect(Object.isFrozen(bootstrap)&&Object.isFrozen(bootstrap.registrations)&&Object.isFrozen(bootstrap.owners)).toBe(true);
});
it('leaves ordinary static owners zero-JS and excludes navigation metadata unless opted in',async()=>{
  const {config}=fixture();delete config.navigationGroups; const {manifest}=await build(config);
  expect(manifest.routes['/shell'].js).toEqual([]);expect(manifest.routes['/shell'].navigation).toBeUndefined();
  expect(manifest.routes['/a'].js).not.toEqual(manifest.routes['/b'].js);
});
it('includes initialization code and every owner in the deployment identity',async()=>{
  const {root,config}=fixture();const initial=await build(config);
  writeFileSync(join(root,'client.ts'),'export default function initialize(group){globalThis.__navigationGroup={...group,changed:true}}');
  const next=await build(config);expect(next.manifest.build).not.toBe(initial.manifest.build);
  writeFileSync(join(root,'shell.ts'),readFileSync(join(root,'shell.ts'),'utf8').replace('persistent','changed owner'));
  expect((await build(config)).manifest.build).not.toBe(next.manifest.build);
});
it.each([
  "h('div',{'data-forma-outlet':'one'}, h('div',{'data-forma-outlet':'two'}))",
  "h('main',null,h('div',{'data-forma-outlet':'one'}),h('div',{'data-forma-outlet':'two'}))",
  "h('div',{'data-forma-outlet':props.name})",
])('refuses malformed owner outlets and preserves the last publication: %s',async(tree)=>{
  const {root,config}=fixture();await build(config);const before=readFileSync(join(config.outputDir,'manifest.json'));
  writeFileSync(join(root,'shell.ts'),`import {h,mount} from '@getforma/core';function Shell(props:{name:string}){return ${tree}}mount(()=>Shell({name:'child'}),'#app');`);
  await expect(build(config)).rejects.toThrow(/navigation owner requires/);expect(readFileSync(join(config.outputDir,'manifest.json'))).toEqual(before);
});
it('refuses an outlet inside an island',async()=>{
  const {root,config}=fixture();writeFileSync(join(root,'shared.ts'),`import {h} from '@getforma/core';export function Counter(props:{count:number}){return h('div',{'data-forma-outlet':'child'})}`);
  await expect(build(config)).rejects.toThrow(/navigation owner requires/);
});
it('refuses registration entry effects',async()=>{
  const {root,config}=fixture();writeFileSync(join(root,'a.ts'),readFileSync(join(root,'a.ts'),'utf8')+';globalThis.injected=true;');
  await expect(build(config)).rejects.toThrow(/registration-only entry accepts/);
});
it('refuses a registration-name collision between distinct original declarations',async()=>{
  const {root,config}=fixture();writeFileSync(join(root,'other.ts'),readFileSync(join(root,'shared.ts'),'utf8'));
  writeFileSync(join(root,'b.ts'),readFileSync(join(root,'b.ts'),'utf8').replace("'./shared'","'./other'"));
  await expect(build(config)).rejects.toThrow(/conflicting island registration Counter/);
});
it.each(['watch','codeSplitting'] as const)('refuses unsupported %s group publication before output changes',async(option)=>{
  const {config}=fixture();config[option]=true;await expect(build(config)).rejects.toThrow(/requires production SSR/);
});
it('refuses asset boundaries that would invalidate retained owners',async()=>{
  const {config}=fixture();config.routes['/b'].fonts=['other.woff2'];await expect(build(config)).rejects.toThrow(/identical CSS and font sets/);
});

it.each(['import(globalThis.moduleUrl)', 'require(globalThis.moduleUrl)'])('refuses executable expressions not represented in the bundler graph: %s',async(expression)=>{
  const {root,config}=fixture();
  writeFileSync(join(root,'client.ts'), `export default async function initialize(group){await ${expression};globalThis.__navigationGroup=group}`);
  await expect(build(config)).rejects.toThrow(/cannot contain a dynamic import expression/);
});
it('bundles a literal lazy dependency into the one verified script',async()=>{
  const {root,config}=fixture();writeFileSync(join(root,'lazy.ts'),'export const ready=true;');
  writeFileSync(join(root,'client.ts'), 'export default async function initialize(group){const value=await import("./lazy");globalThis.__navigationGroup={...group,ready:value.ready}}');
  const {manifest}=await build(config);const js=readFileSync(join(config.outputDir,manifest.routes['/a'].js[0]));
  await import(`data:text/javascript;base64,${js.toString('base64')}`);
  await new Promise(resolve=>setTimeout(resolve,0));
  expect((globalThis as any).__navigationGroup.ready).toBe(true);
});

it('refuses an outlet whose presence depends on request data',async()=>{
  const {root,config}=fixture();
  writeFileSync(join(root,'shell.ts'), `import {h,mount} from '@getforma/core'; function Shell(props:{show:boolean}){return h('main',null,props.show ? h('div',{'data-forma-outlet':'child'}) : null)} mount(()=>Shell({show:true}),'#app');`);
  await expect(build(config)).rejects.toThrow(/navigation owner requires/);
});

const opaquePadding = (length:number):string => {
  let seed=137;const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({length},()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return alphabet[seed%alphabet.length]}).join('');
};
it('holds a verified navigation group to its fixed 64 KiB total even if canvas is declared',async()=>{
  const {root,config}=fixture();for(const route of Object.values(config.routes))route.canvas=true;
  writeFileSync(join(root,'client.ts'), `export default function initialize(group){globalThis.__navigationGroup=group;globalThis.largeApplication=${JSON.stringify(opaquePadding(100_000))}}`);
  await expect(build(config)).rejects.toThrow(/navigation group.*JavaScript.*against 65,536/);
});
it('holds a verified group to the core ceiling plus the fixed 12 KiB prospective increment',async()=>{
  const {root,config}=fixture(),core=join(root,'node_modules/@getforma/core/index.js');
  writeFileSync(core,readFileSync(core,'utf8')+`export const extra=${JSON.stringify(opaquePadding(65_000))};`);
  writeFileSync(join(root,'client.ts'), `import {extra} from '@getforma/core';export default function initialize(group){globalThis.__navigationGroup=group;globalThis.extra=extra}`);
  await expect(build(config)).rejects.toThrow(/navigation group.*Forma code.*against 40,708/);
});
