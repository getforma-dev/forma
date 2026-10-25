import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {build,type Plugin} from 'esbuild';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {listKeyOwnershipSource} from './helpers/list-key-ownership-fixture';

let directory='',coreModule='',ordinaryModule='',compiledModule='';
const coreUrl='/list-key-core.mjs';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
test.beforeAll(async()=>{
 directory=mkdtempSync(join(tmpdir(),'forma-list-key-'));
 const compilerEntry=join(directory,'compiler.ts');
 writeFileSync(compilerEntry,`export {formaClientPlugin} from ${JSON.stringify(fileURLToPath(new URL('../../compiler/src/client-template.ts',import.meta.url)))};`);
 const compiler=await build({entryPoints:[compilerEntry],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
 const compilerFile=join(directory,'compiler.cjs');writeFileSync(compilerFile,compiler.outputFiles[0]!.text);
 const {formaClientPlugin}=createRequire(import.meta.url)(compilerFile);
 const facade=join(directory,'core.ts');
 writeFileSync(facade,`export * from ${JSON.stringify(fileURLToPath(new URL('../src/index.ts',import.meta.url)))};export * from ${JSON.stringify(fileURLToPath(new URL('../src/compiled.ts',import.meta.url)))};`);
 const retained=process.env.FORMA_LIST_KEY_CORE_BUNDLE;
 coreModule=retained?readFileSync(retained,'utf8'):(await build({entryPoints:[facade],bundle:true,write:false,format:'esm',platform:'browser',define:{__FORMA_DEV_BUILD__:'false'},logLevel:'silent'})).outputFiles[0]!.text;
 const entry=join(directory,'fixture.tsx');writeFileSync(entry,listKeyOwnershipSource);
 const shared:Plugin={name:'one-core-graph',setup(builder){builder.onResolve({filter:/^@getforma\/core(?:\/compiled)?$/},()=>({path:coreUrl,external:true}));}};
 for(const compiled of [false,true]){
  const output=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'browser',jsxFactory:'h',plugins:[shared,...compiled?[formaClientPlugin()]:[]],logLevel:'silent'});
  if(compiled)compiledModule=output.outputFiles[0]!.text;else ordinaryModule=output.outputFiles[0]!.text;
 }
 expect(compiledModule).toContain('__createCompiledTemplate');
 expect(ordinaryModule).not.toContain('__createCompiledTemplate');
 const evidence=process.env.FORMA_LIST_KEY_EVIDENCE;
 if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'core.mjs'),coreModule);writeFileSync(join(evidence,'ordinary.mjs'),ordinaryModule);writeFileSync(join(evidence,'compiled.mjs'),compiledModule);writeFileSync(join(evidence,'bundles.json'),JSON.stringify({core:hash(coreModule),ordinary:hash(ordinaryModule),compiled:hash(compiledModule),fixture:hash(listKeyOwnershipSource),retainedCore:retained??null},null,2)+'\n');}
});
test.afterAll(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});

async function start(page:Page,count:number,nan:boolean,rerender=false,duplicate=false,compiled=false){
 await page.route('**/list-key-core.mjs',route=>route.fulfill({contentType:'text/javascript',body:coreModule}));
 await page.route('**/list-key-fixture.mjs',route=>route.fulfill({contentType:'text/javascript',body:compiled?compiledModule:ordinaryModule}));
 await page.route('**/list-key.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main></main><aside></aside></body></html>'}));
 await page.goto('/list-key.html');
 await page.evaluate(async({count,nan,rerender,duplicate})=>{
  const {makeList}=await import('/list-key-fixture.mjs' as string);
  (window as any).list=makeList(document.querySelector('main'),count,nan,rerender,duplicate);
 },{count,nan,rerender,duplicate});
}
async function retain(info:TestInfo,result:unknown){await info.attach('ownership-stages',{body:JSON.stringify(result,null,2),contentType:'application/json'});}
function stopped(rows:any[]){expect(rows.map(row=>[row.effectDelta,row.bindingDelta])).toEqual(rows.map(()=>[0,0]));}

for(const count of [8,31,32,33,64])for(const nan of [false,true]){
 test(`${nan?'NaN':'finite'} key retains one owner and DOM identity at ${count} rows`,async({page},info)=>{
  await start(page,count,nan);
  const result=await page.evaluate(()=>{
   const board=(window as any).list,original=board.ledger.map((entry:any)=>entry.node),stages=[];
   for(let i=0;i<3;i++){board.setItems(board.items().slice());stages.push({count:board.ledger.length,identity:original.every((node:any,index:number)=>board.target.children[index]===node),values:[...board.target.querySelectorAll('input')].map((node:any)=>node.value),tick:board.tick()});}
   board.setItems(board.items().filter((item:any)=>item.token!==0));const removed=board.tick();
   const removedNode=original[0];document.querySelector('aside')!.appendChild(removedNode);const reconnected=board.tick();
   board.dispose();const disposed=board.tick();
   board.setItems([...board.items(),board.make(999)]);const afterDispose=board.tick();
   return {stages,removed,reconnected,disposed,afterDispose,renderCount:board.ledger.length,children:board.target.children.length};
  });
  await retain(info,result);
  for(const stage of result.stages){expect(stage.count).toBe(count);expect(stage.identity).toBe(true);expect(stage.values).toEqual(Array.from({length:count},(_,i)=>`owned-${i}`));expect(stage.tick.map((row:any)=>row.effectDelta)).toEqual(Array(count).fill(1));expect(stage.tick.map((row:any)=>row.bindingDelta)).toEqual(Array(count).fill(1));}
  for(const rows of [result.removed,result.reconnected]){stopped(rows.filter((row:any)=>row.token===0));expect(rows.filter((row:any)=>row.token!==0).map((row:any)=>row.effectDelta)).toEqual(Array(count-1).fill(1));}
  stopped(result.disposed);stopped(result.afterDispose);expect(result.renderCount).toBe(count);expect(result.children).toBe(count-1);
  expect(result.disposed.every((row:any)=>row.effectCleanups===row.effectRuns)).toBe(true);
 });
}

for(const nan of [false,true]){
 test(`${nan?'NaN':'finite'} key keeps its owner when crossing the small-list threshold`,async({page},info)=>{
  await start(page,31,nan);
  const result=await page.evaluate(()=>{
   const board=(window as any).list,first=board.ledger[0].node,stages=[];
   for(const n of [32,33,64,33,32,31,8,33,31]){
    const current=new Map(board.items().map((item:any)=>[item.token,item]));
    board.setItems(Array.from({length:n},(_,i)=>current.get(i)??board.make(i)));
    stages.push({n,firstIdentity:board.target.firstElementChild===first,tick:board.tick(),visible:[...board.target.children].map((node:any)=>Number(node.dataset.token))});
   }
   board.setItems(board.items().slice().reverse());const reorder={firstIdentity:board.target.lastElementChild===first,tick:board.tick()};
   board.setItems([]);const cleared=board.tick();board.dispose();return {stages,reorder,cleared,disposed:board.tick()};
  });
  await retain(info,result);
  for(const stage of result.stages){expect(stage.firstIdentity).toBe(true);expect(stage.visible).toEqual(Array.from({length:stage.n},(_,i)=>i));expect(stage.tick.filter((row:any)=>row.live).map((row:any)=>row.effectDelta)).toEqual(Array(stage.n).fill(1));stopped(stage.tick.filter((row:any)=>!row.live));}
  expect(result.reorder.firstIdentity).toBe(true);stopped(result.reorder.tick.filter((row:any)=>!row.live));stopped(result.cleared);stopped(result.disposed);
 });

 test(`${nan?'NaN':'finite'} rerender retires every replaced generation`,async({page},info)=>{
  await start(page,8,nan,true);
  const result=await page.evaluate(()=>{
   const board=(window as any).list,stages=[];
   for(let version=1;version<=3;version++){
    const prior=[...board.target.children];board.setItems(board.items().map((item:any)=>({...item,version})));
    stages.push({replaced:prior.every((node:any,index:number)=>node!==board.target.children[index]),tick:board.tick()});
   }
   board.setItems([]);const cleared=board.tick();board.dispose();return {stages,cleared,disposed:board.tick(),renderCount:board.ledger.length};
  });
  await retain(info,result);expect(result.renderCount).toBe(32);
  for(const stage of result.stages){expect(stage.replaced).toBe(true);expect(stage.tick.filter((row:any)=>row.live)).toHaveLength(8);stopped(stage.tick.filter((row:any)=>!row.live));}
  stopped(result.cleared);stopped(result.disposed);expect(result.disposed.every((row:any)=>row.effectCleanups===row.effectRuns)).toBe(true);
 });

 test(`${nan?'NaN':'finite'} duplicate keys do not orphan row lifetimes`,async({page},info)=>{
  await start(page,8,nan,false,true);
  const result=await page.evaluate(()=>{
   const board=(window as any).list;for(let i=0;i<3;i++){board.setItems(board.items().slice());board.tick();}
   board.setItems(board.items().filter((item:any)=>item.token>1));const removed=board.tick();
   board.setItems([]);const cleared=board.tick();board.dispose();return {removed,cleared,disposed:board.tick()};
  });
  await retain(info,result);stopped(result.removed.filter((row:any)=>row.token<=1));stopped(result.cleared);stopped(result.disposed);
  expect(result.disposed.every((row:any)=>row.effectCleanups===row.effectRuns)).toBe(true);
 });

 test(`compiled ${nan?'NaN':'finite'} row revokes handlers on remove, clear and parent disposal`,async({page},info)=>{
  await start(page,8,nan,false,false,true);
  const result=await page.evaluate(()=>{
   const board=(window as any).list,original=board.ledger[0].node;
   original.querySelector('button').click();const positive=board.ledger[0].calls;
   for(let i=0;i<3;i++){board.setItems(board.items().slice());board.tick();}
   const identity=board.target.firstElementChild===original;
   board.setItems(board.items().filter((item:any)=>item.token!==0));document.querySelector('aside')!.appendChild(original);original.querySelector('button').click();const removed=board.tick();
   const remaining=[...board.target.children];board.setItems([]);document.querySelector('aside')!.append(...remaining);for(const node of remaining as Element[])node.querySelector<HTMLButtonElement>('button')!.click();const cleared=board.tick();
   board.setItems([board.make(100),board.make(101)]);const live=[...board.target.children];for(const node of live as Element[])node.querySelector<HTMLButtonElement>('button')!.click();const beforeDispose=board.snapshot();
   board.dispose();for(const node of live as Element[])node.querySelector<HTMLButtonElement>('button')!.click();return {positive,identity,removed,cleared,beforeDispose,disposed:board.tick()};
  });
  await retain(info,result);expect(result.positive).toBe(1);expect(result.identity).toBe(true);
  expect(result.removed.filter((row:any)=>row.token===0).map((row:any)=>row.calls)).toEqual([1]);stopped(result.removed.filter((row:any)=>row.token===0));
  expect(result.cleared.filter((row:any)=>row.token!==0).every((row:any)=>row.calls===0)).toBe(true);stopped(result.cleared);
  expect(result.beforeDispose.filter((row:any)=>row.live).map((row:any)=>row.calls)).toEqual([1,1]);expect(result.disposed.map((row:any)=>row.calls)).toEqual(result.beforeDispose.map((row:any)=>row.calls));stopped(result.disposed);
 });
}
