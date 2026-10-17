/** Explicit browserOnly islands use the same declared head-state contract.
 * Original inline-props/fallback assertions are archived verbatim. */
import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {collectDiagnostics} from '../src/diagnostics';
import {readFmirContainer} from '../src/fmir';
import * as C from '../src/fmir-constants';
import {assertBinaryInvariants,getIslands,getSlots,getStrings,parseOpcodeList} from './helpers/fmir';
const CORE="import {h,mount,activateIslands,browserOnly} from '@getforma/core';\n";
let tmpDir:string;
beforeEach(()=>{tmpDir=mkdtempSync(join(tmpdir(),'forma-browser-only-'));vi.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();rmSync(tmpDir,{recursive:true,force:true});});
function emit(files:Record<string,string>) {
  for(const [name,content]of Object.entries(files)){const full=join(tmpDir,name);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,content);}
  return collectDiagnostics(()=>generateRealIr(join(tmpDir,'app.tsx')));
}
function compile(files:Record<string,string>) {
  const {result,diagnostics}=emit(files);expect(result,'a real compiled page, not placeholder').not.toBeNull();
  assertBinaryInvariants(result!.binary);expect(getStrings(result!.binary)).not.toContain('data-forma-props');
  expect(result!.islands.every(island=>island.contract?.mode==='browserOnly')).toBe(true);
  expect(readFmirContainer(result!.binary).sections.find(s=>s.id===C.SECTION_ISLAND_CONTRACTS)?.flags).toBe(C.SECTION_REQUIRED);
  return {result:result!,diagnostics,islands:getIslands(result!.binary),slots:getSlots(result!.binary),ops:parseOpcodeList(result!.binary)};
}
const CHART=CORE+'export const Chart=browserOnly((props:{title?:string})=><canvas aria-label={props.title}/>);';

describe('browserOnly declared state',()=>{
  it('emits an empty mode1 host with ordered declared input slots instead of inline props',()=>{
    const {result,diagnostics,islands,slots,ops}=compile({
      'chart.tsx':CORE+'export const Chart=browserOnly((p:{title:string;count:number;live:boolean;none?:string;neg:number;label:string;skipped?:string})=>window.renderChart(p));',
      'app.tsx':CORE+`import {Chart} from './chart';const LABEL='Quarterly';activateIslands({Chart});mount(()=><main><h1>Report</h1><Chart title="Sales" count={3} live={true} none={null} neg={-2} label={LABEL}/></main>,'#app');`,
    });
    expect(diagnostics).toEqual([]);expect(islands).toHaveLength(1);expect(islands[0]).toMatchObject({name:'Chart',trigger:1});
    expect(result.islands[0]!.contract?.schema[0]?.map(field=>field.name)).toEqual(['count','label','live','neg','none','skipped','title']);
    expect(islands[0]!.slotIds).toHaveLength(7);
    expect(slots.every(slot=>slot.source===C.SLOT_SOURCE_CLIENT)).toBe(true);
    const start=ops.indexOf('ISLAND_START Chart#0');
    expect(ops.slice(start,start+4)).toEqual(['ISLAND_START Chart#0','OPEN_TAG div','CLOSE_TAG div','ISLAND_END Chart#0']);
    expect(ops.join('\n')).not.toMatch(/canvas|renderChart|data-forma-props/);
  });
  it('only declared safe fields become inputs; closed extra keys do not enter head state',()=>{
    const {result,islands}=compile({'chart.tsx':CHART,'app.tsx':CORE+`import {Chart} from './chart';activateIslands({Chart});mount(()=><main>{Chart({title:'Sales',__proto__:'p',constructor:'c'} as never)}</main>,'#app');`});
    expect(result.islands[0]!.contract?.schema).toEqual([[{name:'title',type:{kind:'optional',inner:{kind:'string'}}}]]);
    expect(islands[0]!.slotIds).toHaveLength(1);
  });
  it.each(['__proto__','constructor','prototype'])('refuses reserved declared field %s rather than stripping its contract',name=>{
    expect(()=>emit({'chart.tsx':CORE+`export const Chart=browserOnly((p:{${name}:string})=>window.renderChart(p));`,
      'app.tsx':CORE+`import {Chart} from './chart';activateIslands({Chart});mount(()=><main><Chart/></main>,'#app');`})).toThrow(/BUILD-610/);
  });
  it('omitted optional props are explicit ordered null inputs with no props attribute',()=>{
    const {islands,ops}=compile({'chart.tsx':CHART,'app.tsx':CORE+`import {Chart} from './chart';activateIslands({Chart});mount(()=><main><Chart/></main>,'#app');`});
    expect(islands[0]!.slotIds).toHaveLength(1);expect(ops).toContain('OPEN_TAG div');expect(ops.join('\n')).not.toContain('data-forma-props');
  });
  it('follows barrels, export star, default imports and a declaration in the page module',()=>{
    const forms:Array<[string,Record<string,string>,string]>=[
      ['barrel',{'chart.tsx':CHART,'index.ts':"export {Chart} from './chart';"},"import {Chart} from './index';"],
      ['export star',{'chart.tsx':CHART,'index.ts':"export * from './chart';"},"import {Chart} from './index';"],
      ['default import',{'chart.tsx':CORE+'export default browserOnly(()=><canvas/>);'},"import Chart from './chart';"],
      ['same module',{},'const Chart=browserOnly(()=><canvas/>);'],
    ];
    for(const [label,files,head]of forms){
      rmSync(tmpDir,{recursive:true,force:true});mkdirSync(tmpDir,{recursive:true});
      const {diagnostics,islands}=compile({...files,'app.tsx':CORE+head+"activateIslands({Chart});mount(()=><main><Chart/></main>,'#app');"});
      expect(diagnostics,label).toEqual([]);expect(islands.map(i=>i.name),label).toEqual(['Chart']);
    }
  });
  it('registered browserOnly works below ordinary component nesting while native body stays empty',()=>{
    const {diagnostics,islands,ops}=compile({'chart.tsx':CHART,'app.tsx':CORE+`import {Chart} from './chart';
      function A(){return <section><B/></section>;}function B(){return <article><C/></article>;}function C(){return <div><Chart title="deep"/></div>;}
      activateIslands({Chart});mount(()=><main><A/></main>,'#app');`});
    expect(diagnostics).toEqual([]);expect(islands.map(i=>i.name)).toEqual(['Chart']);expect(ops).not.toContain('OPEN_TAG canvas');
  });
  it('unregistered browserOnly refuses even when its declaration resolves',()=>{
    expect(()=>emit({'chart.tsx':CHART,'app.tsx':CORE+`import {Chart} from './chart';mount(()=><main><Chart title="known"/></main>,'#app');`})).toThrow(/BUILD-610.*must be declared/);
  });
  it('a registered browserOnly still refuses an undeclared dynamic input expression',()=>{
    expect(()=>emit({'chart.tsx':CHART,'app.tsx':CORE+`import {Chart} from './chart';function computeTitle(){return 't';}activateIslands({Chart});mount(()=><main><Chart title={computeTitle()}/></main>,'#app');`})).toThrow(/BUILD-610/);
  });
  it('explicit undefined is not a closed serialized input; omission is the supported optional form',()=>{
    expect(()=>emit({'chart.tsx':CHART,'app.tsx':CORE+`import {Chart} from './chart';activateIslands({Chart});mount(()=><main><Chart title={undefined}/></main>,'#app');`})).toThrow(/BUILD-610/);
  });
  it('a look-alike wrapper cannot obtain an implicit empty host',()=>{
    expect(()=>emit({'app.tsx':CORE+`function clientOnly(fn:()=>unknown){return fn;}const Chart=clientOnly(()=><canvas/>);mount(()=><main><Chart/></main>,'#app');`})).toThrow(/BUILD-610/);
  });
  it('does not resolve an unregistered package component into a fake island',()=>{
    expect(()=>emit({'app.tsx':CORE+`import {Chart} from 'some-chart-package';mount(()=><main><Chart/></main>,'#app');`})).toThrow(/BUILD-610/);
  });
});
