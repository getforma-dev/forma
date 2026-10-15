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
  it('folds closed omitted and null inputs while retaining zero false and empty inputs',()=>{
    const result=emit('closed-nullish','import {Badge} from "./island";export function Page(){return h("main",null,Badge({}),Badge({label:null,count:null,ready:null}),Badge({label:"",count:0,ready:false}));}',
      'export function Badge(p:{label?:string;count?:number;ready?:boolean}){const [label]=createSignal(p.label??"fallback");const [count]=createSignal(p.count??42);const [ready]=createSignal(p.ready??true);return h("p",{"data-ready":ready},label,count);}');
    expect(result.islands).toHaveLength(3);
  });
  it('normalizes optional access only on a known non-null declared props root',()=>{
    const page='import {Badge} from "./island";export function Page(p:{count?:number}){return h("main",null,Badge({count:p.count}));}';
    const island='export function Badge(p:{count?:number}){const [n]=createSignal(p?.count??42);return h("b",null,n);}';
    const optional=emit('optional-root',page,island),direct=emit('optional-root',page,island.replace('p?.count','p.count'));
    expect(optional.binary).toEqual(direct.binary);
    expect(()=>emit('bad','import {Badge} from "./island";export function Page(){return Badge({user:null});}',
      'export function Badge(p:{user?:{count:number}}){const [n]=createSignal(p.user?.count??42);return h("b",null,n);}')).toThrow(/BUILD-610.*optional access/);
    expect(()=>emit('bad',page,'export function Badge(p:{count?:number}){const [n]=createSignal(p?.count??42);return h("b",null,n?.());}')).toThrow(/BUILD-610/);
  });
  it('refuses registered recursion through the same declaration or an imported alias',()=>{
    for(const alias of [false,true])expect(()=>emit('recursive','import {Badge} from "./island";export function Page(){return Badge({label:"loop"});}',
      `${alias?'import {Badge as Again} from "./island";':''}export function Badge(p:{label:string}){return h("p",null,${alias?'Again':'Badge'}({label:p.label}));}`)).toThrow(/BUILD-610.*recursive registered island/);
  });
  it('preserves closed aggregate call inputs and omits optional absent fields from projected state',()=>{
    const result=emit('aggregate','import {Badge} from "./island";export function Page(){return h("main",null,Badge({data:{names:["first",null,"last"],ignored:"strip"}}));}',
      'export function Badge(p:{data:{names:(string|null)[]};note?:string}){return h("b",null,"fixed");}');
    expect(getIslands(result.binary)[0]!.slotIds).toHaveLength(2);expect(getSlots(result.binary).every(slot=>slot.source===C.SLOT_SOURCE_CLIENT)).toBe(true);
  });
  it('preserves nonempty local aggregate seeds and nested row values without handler fields',()=>{
    const result=emit('local-aggregates','import {Badge} from "./island";export function Page(){return h("main",null,Badge({}));}',
      'const [shared]=createSignal([{id:3,user:{name:"capture"}}]);export function Badge(){const [data]=createSignal({title:"local",rows:[{id:1,user:{name:"first"},tags:[{id:"x"},{id:"y"}]},{id:2,user:{name:"second"},tags:[{id:"z"}]}]});const [unused]=createSignal({never:"read"});const [empty]=createSignal([]);return h("section",{"data-title":()=>data().title},createList(()=>data().rows,r=>r.id,r=>h("b",{"data-id":r.id},r.user.name,createList(()=>r.tags,t=>t.id,t=>h("i",null,t.id)))),createList(shared,r=>r.id,r=>h("b",null,r.user.name)),createList(empty,r=>r.id,r=>h("i",null,r.name)));}');
    expect(getSlots(result.binary).every(slot=>slot.source===C.SLOT_SOURCE_CLIENT)).toBe(true);
    expect(getIslands(result.binary)[0]!.slotIds).toEqual([]);
  });
  it('projects literal row inputs into each registered occurrence without changing its schema',()=>{
    emit('local-inputs','import {Badge} from "./island";export function Page(){const [rows]=createSignal([{id:1,user:{name:"one"}},{id:2,user:{name:"two"}}]);return h("main",null,createList(rows,r=>r.id,r=>Badge({label:r.user.name})));}',
      'export function Badge(p:{label:string}){return h("b",null,p.label);}');
  });
  it('pairs a declared optional aggregate with a closed fallback and keyed object rows',()=>{
    // FORMA-181: the archived scalar-row form (`rows?:string[]`, `r=>r`) is a BUILD-612
    // refusal; its unkeyed binary stays a native low-level control in island-emitter/unkeyed/.
    emit('aggregate-fallback','import {Badge} from "./island";export function Page(p:{rows?:{id:string}[]}){return h("main",null,Badge({rows:p.rows}));}',
      'export function Badge(p:{rows?:{id:string}[]}){const [rows]=createSignal(p.rows??[{id:"fallback"}]);return h("section",null,createList(rows,r=>r.id,r=>h("b",null,r.id)));}');
  });
  it('folds a closed nested optional projection before choosing a fallback',()=>{
    emit('nested-closed-nullish','import {Badge} from "./island";export function Page(){return h("main",null,Badge({data:{title:null}}),Badge({data:{title:"kept"}}),Badge({data:{}}));}',
      'export function Badge(p:{data:{title?:string}}){const [title]=createSignal(p.data.title??"fallback");return h("b",null,title);}');
  });
  it('keeps browserOnly expressions outside native execution with declared state',()=>{
    const result=emit('browser','import {Badge} from "./island";export function Page(p:{label:string}){return h("main",null,Badge({label:p.label}));}',
      'export const Badge=browserOnly((p:{label:string})=>window.arbitrary(p));');
    expect(result.islands[0]!.contract?.mode).toBe('browserOnly');
  });
  it('emits the typed roundtrip contract for independent native-to-browser state controls',()=>{
    const fields="label:string;value:number;date:Date;mode:'a'|'b';maybe?:string;list:(number|null)[];nested:{active:boolean}";
    const result=emit('roundtrip',`import {Badge} from "./island";export function Page(p:{${fields}}){return h("main",null,Badge(p));}`,
      `export function Badge(p:{${fields}}){return h("p",null,p.label,p.value);}`);
    const contract=result.islands[0]!.contract!,registration={h:contract.digest,schema:contract.schema,mode:0};
    const text=JSON.stringify(registration,null,2)+'\n';
    if(process.env.FORMA_EMITTER_PROBE_DIR)writeFileSync(join(process.env.FORMA_EMITTER_PROBE_DIR,'roundtrip.registration.json'),text);
    expect(text).toBe(readFileSync(fileURLToPath(new URL('../../../crates/forma-ir/tests/fixtures/island-emitter/roundtrip.registration.json',import.meta.url)),'utf8'));
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
