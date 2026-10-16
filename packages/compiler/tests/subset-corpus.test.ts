/** Live corpus pages must be publishable; originals remain executable refusals. */
import {afterEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as esbuild from 'esbuild';
import {collectDiagnostics} from '../src/diagnostics';
import {formaSsrPlugin, generateRealIr} from '../src/esbuild-ssr-plugin';
import {getSlots} from './helpers/fmir';
const root=resolve(__dirname,'../../..');
const archive=join(root,'docs/archive/FORMA-101-strict-corpus');
const corpus=join(root,'packages/compiler/tests/fixtures/ir-corpus');
afterEach(()=>vi.restoreAllMocks());
const digest=(bytes:Buffer)=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});

it('authenticates the original sources, IR, dump, HTML and state before migration',()=>{
 const manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8'));
 for(const [name,expected] of Object.entries(manifest.sha256))expect(digest(readFileSync(join(archive,name))),name).toEqual(expected);
 const ledger=JSON.parse(readFileSync(join(archive,'ledger.json'),'utf8'));
 for(const [name,entry] of Object.entries(ledger.files) as [string,any][]){
  expect(entry.before,name).toEqual(manifest.sha256[entry.archived]);
  expect(digest(readFileSync(join(root,name))),name).toEqual(entry.after);
 }
});

it.each([['dynamic-attrs','BUILD-206'],['sub-component-scopes','BUILD-503']])('the original %s page refuses publication with %s even with strict:false',async(name,code)=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'log').mockImplementation(()=>{});
 const entryPoint=join(archive,'packages/compiler/tests/fixtures/ir-corpus',name,'app.ts');
 const outDir=mkdtempSync(join(tmpdir(),'forma-strict-corpus-'));
 try {
  let failure:esbuild.BuildFailure|undefined;
  try {await esbuild.build({entryPoints:[entryPoint],bundle:true,write:false,outdir:outDir,format:'esm',packages:'external',logLevel:'silent',plugins:[formaSsrPlugin({page:name,outDir,entryPoint,strict:false})]});}
  catch(error){failure=error as esbuild.BuildFailure;}
  const diagnostic=failure?.errors.find(error=>error.id===code);
  expect(diagnostic?.location?.file).toContain(name);
  expect(diagnostic?.location?.line).toBeGreaterThan(0);
  expect(diagnostic?.location?.column).toBeGreaterThan(0);
  expect(readdirSync(outDir)).toEqual([]);
 } finally {rmSync(outDir,{recursive:true,force:true});}
});

it('every live cross-language corpus module has bytes and no publication errors',()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const cases=readdirSync(corpus,{withFileTypes:true}).filter(entry=>entry.isDirectory());
 expect(cases.length).toBeGreaterThanOrEqual(14);
 for(const entry of cases){
  const app=readdirSync(join(corpus,entry.name)).find(name=>/^app\.tsx?$/.test(name));
  expect(app,entry.name).toBeDefined();
  const {result,diagnostics}=collectDiagnostics(()=>generateRealIr(join(corpus,entry.name,app!)));
  expect(diagnostics.filter(diagnostic=>diagnostic.strict),entry.name).toEqual([]);
  expect(result?.binary.length,entry.name).toBeGreaterThan(0);
  // FMIR v3 may retain private CLIENT debug labels for folded expressions.
  // They must carry real defaults and can never become invented server inputs.
  for(const slot of getSlots(result!.binary).filter(slot=>/^(text:\d|attr:)/.test(slot.name))){
   expect(slot.source,`${entry.name}: ${slot.name}`).toBe(1);
   expect(slot.default.length,`${entry.name}: ${slot.name}`).toBeGreaterThan(0);
  }
 }
});
