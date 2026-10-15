import {afterEach,describe,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {getIslands,getSlots} from './helpers/fmir';
import {readFmirContainer} from '../src/fmir';
import * as C from '../src/fmir-constants';
const dirs:string[]=[];
const core='import {h,createSignal,createList,browserOnly} from "@getforma/core";';
function emit(name:string,page:string,island:string,tsx=false) {
  const dir=mkdtempSync(join(tmpdir(),'forma-contract-emission-'));dirs.push(dir);
  const sources={[tsx?'page.tsx':'page.ts']:core+page,'island.ts':core+island,'app.ts':`import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge} from "./island";activateIslands({Badge});mount(()=>Page(),"#app");`};
  for(const [file,source]of Object.entries(sources))writeFileSync(join(dir,file),source);
  const result=generateRealIr(join(dir,'app.ts'));expect(result).not.toBeNull();
  if(process.env.FORMA_EMITTER_PROBE_DIR){mkdirSync(process.env.FORMA_EMITTER_PROBE_DIR,{recursive:true});writeFileSync(join(process.env.FORMA_EMITTER_PROBE_DIR,`${name}.ir`),result!.binary);}
  if(name!=='bad'&&name!=='bad-date') expect(Buffer.from(result!.binary)).toEqual(readFileSync(fileURLToPath(new URL(`../../../crates/forma-ir/tests/fixtures/island-emitter/${name}.ir`,import.meta.url))));
  return result!;
}
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
describe('declared island writer integration',()=>{
  it('maps repeated ordered fields to a shared declared root without merging local signal identities',()=>{
    const result=emit('repeated','import {Badge} from "./island";export function Page(p:{title:string}){return h("main",null,Badge({left:p.title,right:p.title}));}',
      'export function Badge(p:{left:string;right:string}){const [a,sa]=createSignal(p.left);const [b,sb]=createSignal(p.left);return h("p",null,a,b,p.right);}');
    expect(getIslands(result.binary)[0]!.slotIds).toEqual([0,0]);expect(result.islands[0]!.contract?.digest).toMatch(/^[0-9a-f]{16}$/);
  });
  it('emits declared optional fallback before the host and preserves false zero and empty values',()=>{
    const result=emit('nullish','import {Badge} from "./island";export function Page(p:{label?:string;count?:number;ready?:boolean}){return h("main",null,Badge({label:p.label,count:p.count,ready:p.ready}));}',
      'export function Badge(p:{label?:string;count?:number;ready?:boolean}){const [label,setLabel]=createSignal(p.label??"fallback");const [count,setCount]=createSignal(p.count??42);const [ready,setReady]=createSignal(p.ready??true);return h("p",{"data-ready":ready},label,count);}');
    const opcodes=readFmirContainer(result.binary).sections.find(section=>section.id===C.SECTION_BYTECODE)!.bytes;
    expect(opcodes.includes(C.OP_COALESCE)).toBe(true);expect(getSlots(result.binary).filter(slot=>slot.source===C.SLOT_SOURCE_SERVER).map(slot=>slot.name)).toEqual(['label','count','ready']);
  });
  it('prepares nested row fields before each repeated island occurrence',()=>{
    const result=emit('rows','import {Badge} from "./island";export function Page(p:{rows:{id:number;user:{name:string}}[]}){return h("main",null,createList(()=>p.rows,r=>r.id,r=>Badge({label:r.user.name})));}',
      'export function Badge(p:{label:string}){return h("b",null,p.label);}');
    expect(getIslands(result.binary)).toHaveLength(1);expect(getIslands(result.binary)[0]!.slotIds).toHaveLength(1);
  });
  it('preserves closed aggregate call inputs and omits optional absent fields from projected state',()=>{
    const result=emit('aggregate','import {Badge} from "./island";export function Page(){return h("main",null,Badge({data:{names:["first",null,"last"],ignored:"strip"}}));}',
      'export function Badge(p:{data:{names:(string|null)[]};note?:string}){return h("b",null,"fixed");}');
    expect(getIslands(result.binary)[0]!.slotIds).toHaveLength(2);expect(getSlots(result.binary).every(slot=>slot.source===C.SLOT_SOURCE_CLIENT)).toBe(true);
  });
  it('keeps browserOnly expressions outside native execution with declared state',()=>{
    const result=emit('browser','import {Badge} from "./island";export function Page(p:{label:string}){return h("main",null,Badge({label:p.label}));}',
      'export const Badge=browserOnly((p:{label:string})=>window.arbitrary(p));');
    expect(result.islands[0]!.contract?.mode).toBe('browserOnly');
  });
  it('refuses missing or incompatible declared input and numeric Date impostors',()=>{
    for(const args of ['{}','{label:2}'])expect(()=>emit('bad','import {Badge} from "./island";export function Page(){return Badge('+args+');}',
      'export function Badge(p:{label:string}){return h("p",null,p.label);}')).toThrow(/BUILD-610/);
    expect(()=>emit('bad-date','import {Badge} from "./island";export function Page(){return Badge({date:0});}',
      'export function Badge(p:{date:Date}){return h("p",null,"fixed");}')).toThrow(/BUILD-610/);
  });
  it('refuses unsafe integer source tokens before JSX lowering rounds them',()=>{
    expect(()=>emit('unsafe','import {Badge} from "./island";export function Page(){return <Badge count={9007199254740993}/>;}',
      'export function Badge(p:{count:number}){return h("p",null,p.count);}',true)).toThrow(/BUILD-610.*safe integer/);
  });
});
