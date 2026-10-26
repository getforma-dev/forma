import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from './helpers/named-build';
import { watching } from './helpers/watch';
const currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const currentWriter = currentVersion.split('-')[0].split('.').map(Number);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-build-client-template-')); roots.push(root);
  const src = join(root, 'src'), dist = join(root, 'dist'), core = join(root, 'node_modules/@getforma/core');
  mkdirSync(src); mkdirSync(core, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name:'@getforma/core',version:currentVersion,type:'module',exports:{'.':'./index.js','./compiled':'./compiled.js'} }));
  writeFileSync(join(core, 'index.js'), 'export function h(tag,props,...children){return {tag,props,children}};export const trustedHtml=value=>value;export const createList=(source,key,render)=>(render??key)(source()[0]);');
  writeFileSync(join(core, 'compiled.js'), 'export function __createCompiledTemplate(markup,bindings){return initialize=>{const values=[];initialize((i,value)=>{values[i]=value});return {compiled:true,html:markup(),bindings,values}}}');
  const entry = join(src, 'app.tsx');
  const source = (n: number) => `import {h,createList} from '@getforma/core';const n=${n};globalThis.result=createList(()=>[{id:1}],row=>row.id,row=><div><span>{n}</span></div>);console.log(JSON.stringify(globalThis.result));`;
  writeFileSync(entry, source(7));
  return {root, dist, entry, source, config: {entryPoints:[{entry,outfile:'app.js',ssr:false}],routes:{'/':{js:['app'],css:[]}},outputDir:dist}};
}
function execute(output: string) {
  const executed = spawnSync(process.execPath,[output],{encoding:'utf8'});
  expect(executed.status,executed.stderr).toBe(0);
  return JSON.parse(executed.stdout);
}
it.each([false, true].flatMap(codeSplitting => [undefined,false,true].map(clientTemplates => ({codeSplitting,clientTemplates}))))(
  'compiles only on explicit opt-in (split=$codeSplitting, templates=$clientTemplates)', async ({codeSplitting,clientTemplates}) => {
  const {config,dist} = fixture();
  const result = await build({...config,codeSplitting,clientTemplates});
  const output = join(dist,result.manifest.aliases['app.js']);
  if (clientTemplates) {
    expect(execute(output)).toMatchObject({compiled:true,html:'<div><span></span></div>',bindings:[[[0],1]],values:[7]});
    expect(readFileSync(output,'utf8')).toContain('compiled');
  } else {
    expect(execute(output)).toEqual({tag:'div',props:null,children:[{tag:'span',props:null,children:[7]}]});
    expect(readFileSync(output,'utf8')).not.toContain('compiled');
  }
});
it.each(['false',1,null])('rejects a nonboolean clientTemplates value %s before publication', async value => {
  const {config,dist} = fixture();
  await expect(build({...config,clientTemplates:value as unknown as boolean})).rejects.toThrow('clientTemplates');
  expect(existsSync(dist)).toBe(false);
});
it('refuses opt-in when a compatible compiler lacks the client plugin', async () => {
  const {config,dist} = fixture();
  vi.doMock('@getforma/compiler', () => ({COMPILER_WRITER_VERSION:currentWriter,formaClientPlugin:undefined}));
  try {
    await expect(build({...config,clientTemplates:true})).rejects.toThrow('BUILD-809 clientTemplates requires');
    expect(existsSync(dist)).toBe(false);
  } finally { vi.doUnmock('@getforma/compiler'); }
});
it.each([false,true])('keeps opt-in active across watch rebuilds (split=%s)', async codeSplitting => {
  const {config,dist,entry,source} = fixture();
  await watching({...config,codeSplitting,clientTemplates:true}, async watcher => {
    await watcher.ready();
    const read = () => execute(join(dist,watcher.manifest().aliases['app.js']));
    expect(read()).toMatchObject({compiled:true,values:[7]});
    await watcher.change(() => writeFileSync(entry,source(9)));
    await vi.waitFor(() => expect(read()).toMatchObject({compiled:true,values:[9]}));
  });
},15_000);
