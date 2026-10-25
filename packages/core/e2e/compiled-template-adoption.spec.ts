import {test,expect,type Page} from '@playwright/test';
import {build,type Plugin} from 'esbuild';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {boardSource,servedBoard,nativeIslandSource,nativePageSource,nativeEntrySource,nativeListSource} from './helpers/compiled-template-fixtures';

let directory='',coreModule='',boardModule='',nativeModule='',nativeListModule='',contract='',listContract='';
const coreUrl='/compiler-template-core.mjs';
const sharedCore:Plugin={name:'one-test-core-graph',setup(builder){
 builder.onResolve({filter:/^@getforma\/core(?:\/compiled)?$/},()=>({path:coreUrl,external:true}));
}};
test.beforeAll(async()=>{
 directory=mkdtempSync(join(tmpdir(),'forma-compiled-adoption-'));
 // Playwright's TS loader leaves the compiler's package.json import intact.
 // Build its real sources as CJS first, just as a package consumer loads built
 // code; do not replace the compiler with a test transform or metadata stub.
 const compilerEntry=join(directory,'compiler-entry.ts');
 writeFileSync(compilerEntry,`export {formaClientPlugin} from ${JSON.stringify(fileURLToPath(new URL('../../compiler/src/client-template.ts',import.meta.url)))};export {formaSsrPlugin,generateRealIr} from ${JSON.stringify(fileURLToPath(new URL('../../compiler/src/esbuild-ssr-plugin.ts',import.meta.url)))};`);
 const compilerBuild=await build({entryPoints:[compilerEntry],bundle:true,write:false,format:'cjs',platform:'node',define:{'import.meta.url':JSON.stringify(new URL('../../compiler/src/module-loader.ts',import.meta.url).href)},logLevel:'silent'});
 const compilerFile=join(directory,'compiler.cjs');writeFileSync(compilerFile,compilerBuild.outputFiles[0]!.text);
 const {formaClientPlugin,formaSsrPlugin,generateRealIr}=createRequire(import.meta.url)(compilerFile);
 const core=fileURLToPath(new URL('../src/index.ts',import.meta.url));
 const compiled=fileURLToPath(new URL('../src/compiled.ts',import.meta.url));
 // Both public facades enter one esbuild graph. A second copy of adoption
 // context or reactive ownership could otherwise make a false passing test.
 const facade=join(directory,'core.ts');
 writeFileSync(facade,`export * from ${JSON.stringify(core)};export * from ${JSON.stringify(compiled)};`);
 const bundled=await build({entryPoints:[facade],bundle:true,write:false,format:'esm',platform:'browser',define:{__FORMA_DEV_BUILD__:'false'},logLevel:'silent'});
 coreModule=bundled.outputFiles[0]!.text;
 const board=join(directory,'board.tsx');writeFileSync(board,boardSource);
 const browser=await build({entryPoints:[board],bundle:true,write:false,format:'esm',platform:'browser',jsxFactory:'h',jsxFragment:'Fragment',plugins:[sharedCore,formaClientPlugin()],logLevel:'silent'});
 boardModule=browser.outputFiles[0]!.text;
 expect(boardModule).toContain('__createCompiledTemplate');
 expect(boardModule).toContain(coreUrl);
 writeFileSync(join(directory,'island.tsx'),nativeIslandSource);
 writeFileSync(join(directory,'page.tsx'),nativePageSource);
 const entry=join(directory,'entry.tsx');writeFileSync(entry,nativeEntrySource);
 const native=generateRealIr(entry)!;
 expect(native.islands).toHaveLength(1);contract=native.islands[0]!.contract!.digest;
 const paired=await build({entryPoints:[entry],outdir:join(directory,'dist'),bundle:true,write:false,format:'esm',platform:'browser',jsxFactory:'h',jsxFragment:'Fragment',plugins:[sharedCore,formaSsrPlugin({page:'entry',outDir:join(directory,'dist'),entryPoint:entry}),formaClientPlugin()],logLevel:'silent'});
 nativeModule=paired.outputFiles!.find(output=>output.path.endsWith('.js'))!.text;
 expect(paired.outputFiles!.find(output=>output.path.endsWith('.ir'))!.contents).toEqual(native.binary);
 // Single-use islands stay on their existing adoption path. Only inline
 // createList renderers opt into compiled construction automatically.
 expect(nativeModule).not.toContain('__createCompiledTemplate');
 expect(nativeModule).toContain('__adoptionWritable');
 const listEntry=join(directory,'native-list.tsx');writeFileSync(listEntry,nativeListSource);
 const listIr=generateRealIr(listEntry)!;expect(listIr.islands).toHaveLength(1);
 listContract=listIr.islands[0]!.contract!.digest;
 const listPaired=await build({entryPoints:[listEntry],outdir:join(directory,'list-dist'),bundle:true,write:false,format:'esm',platform:'browser',jsxFactory:'h',jsxFragment:'Fragment',plugins:[sharedCore,formaSsrPlugin({page:'native-list',outDir:join(directory,'list-dist'),entryPoint:listEntry}),formaClientPlugin()],logLevel:'silent'});
 nativeListModule=listPaired.outputFiles!.find(output=>output.path.endsWith('.js'))!.text;
 expect(listPaired.outputFiles!.find(output=>output.path.endsWith('.ir'))!.contents).toEqual(listIr.binary);
 expect(nativeListModule).toContain('__createCompiledTemplate');
});
test.afterAll(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});

async function serve(page:Page,body:string,head='',strict=false){
 await page.route('**/compiler-template-core.mjs',route=>route.fulfill({contentType:'text/javascript',body:coreModule}));
 await page.route('**/compiler-template-board.mjs',route=>route.fulfill({contentType:'text/javascript',body:boardModule}));
 await page.route('**/compiler-template-native.mjs',route=>route.fulfill({contentType:'text/javascript',body:nativeModule}));
 await page.route('**/compiler-template-native-list.mjs',route=>route.fulfill({contentType:'text/javascript',body:nativeListModule}));
 await page.route('**/compiler-template.html',route=>route.fulfill({contentType:'text/html',...(strict?{headers:{'Content-Security-Policy':"default-src 'none'; script-src 'self'; object-src 'none'; require-trusted-types-for 'script'; trusted-types forma forma-runtime forma-frame"}}:{}),body:`<!doctype html><html><head>${head}</head><body>${body}</body></html>`}));
 await page.goto('/compiler-template.html');
}
async function start(page:Page,adopt:boolean,strict=false){
 await serve(page,`<div id="app">${adopt?servedBoard:''}</div><div id="neighbor"></div>`,'',strict);
 return page.evaluate(async adopt=>{
  const module=await import('/compiler-template-board.mjs' as string),target=document.querySelector('#app')!;
  const before:Node[]=[],walk=document.createTreeWalker(target);for(let n=walk.nextNode();n;n=walk.nextNode())before.push(n);
  const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));
  observer.observe(target,{subtree:true,attributes:true,childList:true,characterData:true});
  const captured:{target:EventTarget;listener:EventListenerOrEventListenerObject}[]=[];
  const add=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){
   if(type==='click'&&listener)captured.push({target:this,listener});
   return add.call(this,type,listener,options);
  };
  let board:any,templateCreates=0;
  const create=Document.prototype.createElement;
  Document.prototype.createElement=function(name,options){if(name.toLowerCase()==='template')templateCreates++;return create.call(this,name,options);};
  try{board=module.makeBoard(target,adopt);}finally{EventTarget.prototype.addEventListener=add;Document.prototype.createElement=create;}
  (window as any).board=board;(window as any).capturedCompiledListeners=captured;
  await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());
  const initialWrites=records.length,after:Node[]=[],afterWalk=document.createTreeWalker(target);
  for(let n=afterWalk.nextNode();n;n=afterWalk.nextNode())after.push(n);
  records.length=0;target.setAttribute('data-observer-positive','1');
  await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());observer.disconnect();
  return {initialWrites,templateCreates,retained:before.length===after.length&&before.every((node,index)=>node===after[index]),positive:records.some(r=>r.target===target&&r.attributeName==='data-observer-positive'),errors:board.errors.map((error:any)=>error.code)};
 },adopt);
}

for(const adopt of [false,true]){
 const mode=adopt?'adopted':'CSR';
 test(`${mode} compiled rows retain live ownership through updates and fresh insertion`,async({page})=>{
  const initial=await start(page,adopt);
  expect(initial.positive).toBe(true);expect(initial.errors).toEqual([]);
  if(adopt)expect(initial).toMatchObject({initialWrites:0,templateCreates:0,retained:true});
  const result=await page.evaluate(()=>{
   const b=(window as any).board,first=document.querySelector('[data-row="1"]')!,second=document.querySelector('[data-row="2"]')!;
   b.records.get(1).setValue('changed');first.querySelector<HTMLButtonElement>('.label')!.click();
   const live={label:first.querySelector('.label')!.textContent,className:first.className,calls:b.calls.select};
   const third=b.make(3,'three');b.setItems([b.records.get(2),third,b.records.get(1)]);
   const inserted=document.querySelector('[data-row="3"]')!;
   third.setValue('fresh');inserted.querySelector<HTMLButtonElement>('.label')!.click();
   const after={order:[...document.querySelectorAll('li')].map(node=>node.getAttribute('data-row')),firstRetained:document.querySelector('[data-row="1"]')===first,secondRetained:document.querySelector('[data-row="2"]')===second,newLabel:inserted.querySelector('.label')!.textContent,newClass:inserted.className,calls:b.calls.select,errors:b.errors.map((e:any)=>e.code)};
   b.dispose();return{live,after};
  });
  expect(result.live).toEqual({label:'changed',className:'chosen',calls:1});
  expect(result.after).toEqual({order:['2','3','1'],firstRetained:true,secondRetained:true,newLabel:'fresh',newClass:'chosen',calls:2,errors:[]});
 });

 for(const action of ['remove','clear','parent'] as const)test(`${mode} ${action} stops actual row effects and revokes reconnected handlers`,async({page})=>{
  await start(page,adopt);
  const result=await page.evaluate(action=>{
   const b=(window as any).board,ul=document.querySelector('#app ul')!,nodes=[...ul.querySelectorAll('li')];
   // Positive controls prove these effects/listeners were live before disposal.
   let positive=true;
   for(const node of nodes){
    const item=b.records.get(Number(node.getAttribute('data-row'))),before={...item.reads};
    item.setValue('live-'+item.id);node.querySelector<HTMLButtonElement>('.label')!.click();
    positive&&=node.querySelector('.label')!.textContent==='live-'+item.id&&node.className==='chosen'&&item.reads.label>before.label&&item.reads.selected>before.selected;
   }
   positive&&=b.calls.select===2;
   if(action==='remove')nodes[0].querySelector<HTMLButtonElement>('.remove')!.click();
   else if(action==='clear')b.setItems([]);else b.dispose();
   const affected=action==='remove'?[nodes[0]]:nodes;
   const afterActionCount=ul.querySelectorAll('li').length;
   const snapshots=affected.map(node=>{const item=b.records.get(Number(node.getAttribute('data-row')));return{item,reads:{...item.reads},text:node.textContent,className:node.className,node};});
   for(const row of snapshots){row.item.setValue('stale');b.setSelected(row.item.id);}
   const stopped=snapshots.every(row=>row.item.reads.label===row.reads.label&&row.item.reads.selected===row.reads.selected&&row.node.textContent===row.text&&row.node.className===row.className);
   // Reconnect under the still-live delegation tree for removal/clear. A click
   // on a merely detached node would not exercise a document dispatcher.
   for(const node of affected)ul.append(node);
   const beforeCalls={...b.calls};
   for(const node of affected)for(const selector of ['.label','.remove'])node.querySelector<HTMLButtonElement>(selector)!.click();
   const revoked=b.calls.select===beforeCalls.select&&b.calls.remove===beforeCalls.remove;
   let survivor=true;
   if(action==='remove'){
    const item=b.records.get(2);item.setValue('survivor');nodes[1].querySelector<HTMLButtonElement>('.label')!.click();
    survivor=nodes[1].querySelector('.label')!.textContent==='survivor'&&nodes[1].className==='chosen'&&b.calls.select===beforeCalls.select+1;
   }
   b.dispose();return{positive,stopped,revoked,survivor,afterActionCount,connected:affected.every(node=>node.isConnected),errors:b.errors.map((e:any)=>e.code)};
  },action);
  expect(result).toEqual({positive:true,stopped:true,revoked:true,survivor:true,afterActionCount:action==='remove'?1:action==='clear'?0:2,connected:true,errors:[]});
 });
}

test('compiled manual cleanup revokes one event slot or a whole template without removing unrelated native listeners',async({page})=>{
 await start(page,false);
 const result=await page.evaluate(()=>{
  const b=(window as any).board,rows=[...document.querySelectorAll('li')],label=rows[0].querySelector<HTMLButtonElement>('.label')!;
  let external=0;label.addEventListener('click',()=>external++);
  b.cleanup(label);label.click();
  const slot={selected:b.calls.select,external};
  rows[1].querySelector<HTMLButtonElement>('.label')!.click();
  b.cleanup(rows[0]);rows[0].querySelector<HTMLButtonElement>('.remove')!.click();label.click();
  const group={selected:b.calls.select,removed:b.calls.remove,external,rows:document.querySelectorAll('li').length};
  rows[1].querySelector<HTMLButtonElement>('.remove')!.click();
  const survivorRemoved=b.calls.remove===1&&document.querySelectorAll('li').length===1;
  b.dispose();return{slot,group,survivorRemoved};
 });
 expect(result).toEqual({slot:{selected:0,external:1},group:{selected:1,removed:0,external:2,rows:2},survivorRemoved:true});
});

test('parent disposal revokes compiled row slots independently of physical listener removal',async({page})=>{
 await start(page,false);
 const result=await page.evaluate(()=>{
  const b=(window as any).board,records=(window as any).capturedCompiledListeners;
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('#app button')];
  b.dispose();const before={...b.calls};
  for(const button of buttons){
   const path:EventTarget[]=[];for(let node:Node|null=button;node;node=node.parentNode)path.push(node);path.push(window);
   for(const record of records){
    // Deliberately bypass native removal/AbortSignal, solely to prove revoked
    // slot ownership. This surrogate is not a native propagation assertion.
    const event={type:'click',target:button,currentTarget:record.target,cancelBubble:false,composedPath:()=>path,stopPropagation(){this.cancelBubble=true;},stopImmediatePropagation(){this.cancelBubble=true;}};
    if(typeof record.listener==='function')record.listener.call(record.target,event);else record.listener.handleEvent(event);
   }
  }
  return{captured:records.length,revoked:JSON.stringify(before)===JSON.stringify(b.calls)};
 });
 expect(result.captured).toBeGreaterThan(0);expect(result.revoked).toBe(true);
});

test('an initial compiled reader throw leaves served DOM untouched and releases already prepared rows',async({page})=>{
 await serve(page,`<div id="app">${servedBoard}</div>`);
 const result=await page.evaluate(async()=>{
  const module=await import('/compiler-template-board.mjs' as string),target=document.querySelector('#app')!;
  const html=target.innerHTML,nodes=[...target.querySelectorAll('*')],records:MutationRecord[]=[];
  const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(target,{subtree:true,childList:true,characterData:true,attributes:true});
  let thrown:unknown;try{module.makeBoard(target,true,true);}catch(error){thrown=error;}
  const b=module.lastBoard,before=[...b.records.values()].map((row:any)=>({...row.reads}));
  for(const row of b.records.values()){row.fail=false;row.setValue('after failure');b.setSelected(row.id);}
  const stopped=[...b.records.values()].every((row:any,index:number)=>JSON.stringify(row.reads)===JSON.stringify(before[index]));
  for(const button of target.querySelectorAll<HTMLButtonElement>('button'))button.click();
  await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());observer.disconnect();
  const after=[...target.querySelectorAll('*')];b.dispose();
  return{sameError:thrown===b.records.get(2).error,stopped,unchanged:target.innerHTML===html,retained:nodes.length===after.length&&nodes.every((node,index)=>node===after[index]),writes:records.length,calls:b.calls};
 });
 expect(result).toEqual({sameError:true,stopped:true,unchanged:true,retained:true,writes:0,calls:{select:0,remove:0}});
});

test('adopted compiled reader failure aborts only its owner and preserves an ordinary neighbor',async({page})=>{
 await start(page,true);
 const result=await page.evaluate(async()=>{
  const b=(window as any).board,core=await import('/compiler-template-core.mjs' as string);
  const [value,set]=core.createSignal('outside');let reads=0;
  const dispose=core.createRoot((stop:()=>void)=>{document.querySelector('#neighbor')!.append(core.h('span',null,()=>{reads++;return value();}));return stop;});
  const item=b.records.get(1);item.fail=true;item.setValue('bad');
  const failure=b.errors.map((e:any,index:number)=>({sameError:e===item.error,nativeError:e instanceof Error,message:e.message,source:b.errorInfos[index]?.source}));
  const before=[...b.records.values()].map((row:any)=>({...row.reads}));
  for(const row of b.records.values()){row.fail=false;row.setValue('after');b.setSelected(row.id);}
  const stopped=[...b.records.values()].every((row:any,index:number)=>JSON.stringify(row.reads)===JSON.stringify(before[index]));
  const calls={...b.calls};for(const button of document.querySelectorAll<HTMLButtonElement>('#app button'))button.click();
  set('neighbor-live');const neighbor=document.querySelector('#neighbor span')!.textContent;
  b.dispose();dispose();return{failure,stopped,revoked:JSON.stringify(calls)===JSON.stringify(b.calls),neighbor,reads};
 });
 expect(result.failure).toEqual([{sameError:true,nativeError:true,message:'row reader 1',source:'hydration'}]);
 expect(result).toMatchObject({stopped:true,revoked:true,neighbor:'neighbor-live',reads:2});
});

function nativeDocument(count=1,wrongFirst=false){
 const body='<main id="app">'+Array.from({length:count},(_,i)=>`<section data-forma-island="0" data-forma-component="Counter" data-forma-h="${contract}" data-forma-state="${i}" data-forma-status="pending"><input value="${wrongFirst&&i===0?'wrong':'seed'}"><button><span>append</span></button></section>`).join('')+'</main>';
 const head=`<script type="application/json" data-island-state>${JSON.stringify({v:1,s:[],i:Array.from({length:count},()=>({h:contract,p:{text:'seed'}}))})}</script>`;
 return{body,head};
}
test('single-use native compiler output keeps early input, focus and every served node with zero initial writes',async({page})=>{
 const doc=nativeDocument();await serve(page,doc.body,doc.head);
 await page.locator('input').fill('user');await page.locator('input').focus();
 const result=await page.evaluate(async()=>{
  const root=document.querySelector('section')!,input=root.querySelector('input')!;
  input.setSelectionRange(1,3,'backward');const before:Node[]=[root],walker=document.createTreeWalker(root);for(let node=walker.nextNode();node;node=walker.nextNode())before.push(node);
  const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));
  observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true});
  const value=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!;let writes=0;
  Object.defineProperty(input,'value',{configurable:true,get(){return value.get!.call(this);},set(v){writes++;value.set!.call(this,v);}});
  await import('/compiler-template-native.mjs' as string);
  await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());observer.disconnect();
  const after:Node[]=[root],walkAfter=document.createTreeWalker(root);for(let node=walkAfter.nextNode();node;node=walkAfter.nextNode())after.push(node);
  const initial={mutations:records.length,writes,value:input.value,focus:document.activeElement===input,selection:[input.selectionStart,input.selectionEnd,input.selectionDirection],retained:before.length===after.length&&before.every((node,index)=>node===after[index]),status:root.getAttribute('data-forma-status')};
  root.querySelector('button')!.click();return{initial,after:input.value};
 });
 expect(result).toEqual({initial:{mutations:0,writes:0,value:'user',focus:true,selection:[1,3,'backward'],retained:true,status:'pending'},after:'user!'});
});
test('a compiled native mismatch refuses one island without binding its listener or disturbing its neighbor',async({page})=>{
 const doc=nativeDocument(2,true);await serve(page,doc.body,doc.head);
 const result=await page.evaluate(async()=>{
  const core=await import('/compiler-template-core.mjs' as string),errors:string[]=[];
  const stop=core.onError((e:any)=>errors.push(e.code));
  const roots=[...document.querySelectorAll('section')],nodes=roots.flatMap(root=>[root,...root.childNodes]);
  await import('/compiler-template-native.mjs' as string);
  roots[0].querySelector('button')!.click();roots[1].querySelector('button')!.click();
  const after=roots.flatMap(root=>[root,...root.childNodes]);stop();
  return{errors,retained:nodes.every((node,index)=>node===after[index]),states:roots.map(root=>root.getAttribute('data-forma-status')),values:roots.map(root=>root.querySelector('input')!.value)};
 });
 expect(result).toEqual({errors:['FORMA_E_HYDRATE_VALUE'],retained:true,states:['error','pending'],values:['wrong','seed!']});
});

test('paired native list output adopts without parsing a template and owns post-commit inserted rows',async({page})=>{
 const state={v:1,s:[],i:[{h:listContract,p:{rows:[]}}]};
 const markup=`<main id="app"><section data-forma-island="0" data-forma-component="Rows" data-forma-h="${listContract}" data-forma-state="0" data-forma-status="pending"><button class="add">add</button><ul><!--f:l0--><!--/f:l0--></ul></section></main>`;
 await serve(page,markup,`<script type="application/json" data-island-state>${JSON.stringify(state)}</script>`,true);
 const result=await page.evaluate(async()=>{
  const core=await import('/compiler-template-core.mjs' as string),errors:unknown[]=[];
  const stop=core.onError((error:unknown)=>errors.push(error));
  const target=document.querySelector('#app')!,before:Node[]=[],walker=document.createTreeWalker(target);
  for(let node=walker.nextNode();node;node=walker.nextNode())before.push(node);
  let templates=0;const create=Document.prototype.createElement;
  Document.prototype.createElement=function(name,options){if(name.toLowerCase()==='template')templates++;return create.call(this,name,options);};
  const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));
  observer.observe(target,{subtree:true,childList:true,characterData:true,attributes:true});
  try{await import('/compiler-template-native-list.mjs' as string);}finally{Document.prototype.createElement=create;}
  await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());observer.disconnect();
  const after:Node[]=[],walkAfter=document.createTreeWalker(target);for(let node=walkAfter.nextNode();node;node=walkAfter.nextNode())after.push(node);
  const initial={templates,writes:records.length,retained:before.length===after.length&&before.every((node,index)=>node===after[index])};
  const add=target.querySelector<HTMLButtonElement>('.add')!;add.click();add.click();
  const rows=[...target.querySelectorAll('li')],live=rows.length===2&&rows.every(row=>row.querySelector('span')?.textContent==='fresh');
  rows[0]!.querySelector<HTMLButtonElement>('.remove')!.click();
  const removed=target.querySelectorAll('li').length===1&&target.querySelector('li')===rows[1];
  target.querySelector('ul')!.append(rows[0]!);rows[0]!.querySelector<HTMLButtonElement>('.remove')!.click();
  const staleInert=target.querySelectorAll('li').length===2&&target.querySelector('[data-row="2"]')===rows[1];
  stop();return{initial,live,removed,staleInert,errors:errors.map((e:any)=>e.code)};
 });
 expect(result).toEqual({initial:{templates:0,writes:0,retained:true},live:true,removed:true,staleInert:true,errors:[]});
});

test('compiled CSR and fresh rows work under enforced CSP while hostile literals remain text',async({page,browserName})=>{
 await serve(page,'<div id="app"></div>','',true);
 const result=await page.evaluate(async()=>{
  const violations:string[]=[];document.addEventListener('securitypolicyviolation',event=>violations.push(event.violatedDirective));
  const module=await import('/compiler-template-board.mjs' as string),target=document.querySelector('#app')!;
  const board=module.makeHostileBoard(target);board.add();
  for(const button of target.querySelectorAll<HTMLButtonElement>('button'))button.click();
  const good={texts:[...target.querySelectorAll('span')].map(n=>n.textContent),titles:[...target.querySelectorAll('li')].map(n=>n.getAttribute('title')),images:target.querySelectorAll('img').length,calls:board.calls(),xss:(window as any).__compilerXss??null};
  await new Promise(resolve=>setTimeout(resolve,0));const ordinaryViolations=[...violations];
  let refused=false;try{document.createElement('div').innerHTML='<i>untrusted control</i>';}catch(error){refused=error instanceof TypeError;}
  await new Promise(resolve=>setTimeout(resolve,0));board.dispose();
  return{good,ordinaryViolations,tt:typeof(window as any).trustedTypes!=='undefined',refused,violations};
 });
 expect(result.good).toEqual({texts:Array(2).fill('<img src=x onerror=globalThis.__compilerXss=1> & quoted'),titles:Array(2).fill('" onmouseover="globalThis.__compilerXss=1'),images:0,calls:2,xss:null});
 expect(result.ordinaryViolations).toEqual([]);
 if(browserName==='chromium'){expect(result.tt).toBe(true);expect(result.refused).toBe(true);expect(result.violations).toContain('require-trusted-types-for');}
 else expect(result.refused).toBe(result.tt);
});

test('compiled adoption uses no markup factory under strict CSP and rejects untrusted direct factories',async({page})=>{
 const initial=await start(page,true,true);
 expect(initial).toMatchObject({initialWrites:0,templateCreates:0,retained:true,errors:[]});
 const result=await page.evaluate(async()=>{
  const core=await import('/compiler-template-core.mjs' as string);let coercions=0,initializers=0;
  const bad=[()=>'<section><span>bad</span></section>',()=>({__formaTrustedHtml:true,toString(){coercions++;return'<section>bad</section>';}})];
  const outcomes=bad.map(markup=>{try{core.__createCompiledTemplate(markup,[])(()=>{initializers++;});return{accepted:true};}catch(error){return{accepted:false,nativeTypeError:error instanceof TypeError,message:String((error as Error).message)};}});
  (window as any).board.dispose();return{outcomes,coercions,initializers};
 });
 expect(result.outcomes).toHaveLength(2);for(const outcome of result.outcomes){expect(outcome).toMatchObject({accepted:false,nativeTypeError:true});expect(outcome.message).toContain('FORMA_E_RAW_TEMPLATE');}
 expect(result).toMatchObject({coercions:0,initializers:0});
});

test('compiled stages preserve initial effects before later sibling expression evaluation',async({page})=>{
 await serve(page,'<div id="app"></div>');
 const result=await page.evaluate(async()=>{
  const module=await import('/compiler-template-board.mjs' as string),state=module.makeInterleaved(document.querySelector('#app'));
  const initial={trace:[...state.trace],title:document.querySelector('button')!.title,text:document.querySelector('span')!.textContent};
  state.setValue('next');const next={trace:[...state.trace],title:document.querySelector('button')!.title,text:document.querySelector('span')!.textContent};
  state.dispose();return{initial,next};
 });
 expect(result).toEqual({initial:{trace:['parent-expression','effect:first','later-expression:1'],title:'1',text:'first'},next:{trace:['parent-expression','effect:first','later-expression:1','effect:next'],title:'1',text:'next'}});
});

test('compiled handler revocation survives owner disposal during row initialization',async({page})=>{
 await serve(page,'<div id="compiled"></div><div id="ordinary"></div>');
 const result=await page.evaluate(async()=>{
  const module=await import('/compiler-template-board.mjs' as string);
  const run=(compiled:boolean)=>{
   const target=document.querySelector(compiled?'#compiled':'#ordinary')!,state=module.makeDisposing(target,compiled);
   const before=state.reads();state.setValue('later');
   const button=target.querySelector<HTMLButtonElement>('button')!;button.click();
   const stopped=state.reads()===before,first=state.calls();button.remove();target.append(button);button.click();state.dispose();
   return{stopped,first,afterReconnect:state.calls(),text:target.querySelector('span')!.textContent};
  };
  return{ordinary:run(false),compiled:run(true)};
 });
 // Ordinary h listeners are element-owned; retain their counts as a diagnostic,
 // not an invariant of root disposal. Compiled ownership must still revoke both.
 console.log('ordinary-element-owned-listener-diagnostic',JSON.stringify(result.ordinary));
 expect(result.ordinary).toMatchObject({stopped:true,text:'first'});
 expect(result.compiled).toEqual({stopped:true,first:0,afterReconnect:0,text:'first'});
});

test('a later expression throw after setup disposal cannot retain subsequently created row effects',async({page})=>{
 await serve(page,'<div id="app"></div>');
 const result=await page.evaluate(async()=>{
  const module=await import('/compiler-template-board.mjs' as string);
  const run=(compiled:boolean)=>{
   const state=module.makeDisposingThrow(compiled),before=state.reads();state.setValue('after failure');
   return{sameError:state.thrown===state.expected,nativeError:state.thrown instanceof Error,message:state.thrown?.message,before,after:state.reads()};
  };
  return{ordinary:run(false),compiled:run(true)};
 });
 expect(result.ordinary).toEqual({sameError:true,nativeError:true,message:'later expression',before:[1,1],after:[1,1]});
 expect(result.compiled).toEqual(result.ordinary);
});
