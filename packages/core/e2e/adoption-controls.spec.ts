import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

let moduleText='';
test.beforeAll(async()=>{
 const result=await build({entryPoints:[fileURLToPath(new URL('../src/dom/adoption-controls.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',define:{__FORMA_DEV_BUILD__:'false'},logLevel:'silent'});
 // This appended helper exists only in the private test module. Keep every
 // delivered batch, then drain pending records after a macrotask. The separate
 // positive write happens after the measured read-only phase.
 moduleText=result.outputFiles[0]!.text+`
 export function observeMutations() {
  const records=[];
  const observer=new MutationObserver(batch=>records.push(...batch));
  observer.observe(document,{subtree:true,attributes:true,childList:true,characterData:true});
  return async function finishObservation() {
   await new Promise(resolve=>setTimeout(resolve,0));
   records.push(...observer.takeRecords());
   const mutations=records.length;records.length=0;
   const target=document.documentElement;
   target.setAttribute('data-observer-control','present');
   await new Promise(resolve=>setTimeout(resolve,0));
   records.push(...observer.takeRecords());observer.disconnect();
   const positive=records.filter(record=>record.type==='attributes'&&record.target===target&&record.attributeName==='data-observer-control').length;
   return {mutations,positive};
  };
 }
 `;
});
async function serve(page:Page,html:string){
 await page.route('**/control-kernel.mjs',route=>route.fulfill({contentType:'text/javascript',body:moduleText}));
 await page.route('**/control-kernel.html',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; object-src 'none'; require-trusted-types-for 'script'; trusted-types forma-runtime forma-frame"},body:`<!doctype html><html><head></head><body>${html}</body></html>`}));
 await page.goto('/control-kernel.html');
}
test('native radio defaults use form/name groups and last checked winner without writes',async({page})=>{
 await serve(page,'<form id="f"></form><section id="host"><input id="a" type="radio" name="r" form="f" checked><input id="b" type="radio" name="r" form="f" checked><form><input id="other" type="radio" name="r" checked></form></section><input id="peer" type="radio" name="r" form="f">');
 const result=await page.evaluate(async()=>{
  const {AdoptionControls,observeMutations}=await import('/control-kernel.mjs' as string),get=(id:string)=>document.getElementById(id) as HTMLInputElement;
  const finishObservation=observeMutations();
  const controls=new AdoptionControls(get('host'));controls.add({element:get('b'),key:'checked',initial:true});controls.add({element:get('a'),key:'checked',initial:true});controls.add({element:get('other'),key:'checked',initial:true});
  const observed=controls.finish().map(({edited,value}:any)=>({edited,value}));controls.check();const observation=await finishObservation();
  get('peer').checked=true;let changed='';try{controls.check();}catch(error){changed=(error as any).code;}controls.release();
  return {observed,...observation,changed};
 });
 expect(result).toEqual({observed:[{edited:false,value:true},{edited:false,value:false},{edited:false,value:true}],mutations:0,positive:1,changed:'FORMA_E_HYDRATE_VALUE'});
});
test('native sanitized defaults and an early text edit preserve focus selection and setter count',async({page})=>{
 await serve(page,'<section id="host"><input id="text" value="saved"><input id="range" type="range" min="10" max="20" value="99"><input id="number" type="number" value="7"><input id="color" type="color" value="not-a-color"><input id="mail" type="email" value="  a@example.com  "><textarea id="area">saved notes</textarea></section>');
 await page.locator('#text').fill('typed before prepare');await page.locator('#text').focus();
 const result=await page.evaluate(async()=>{
  const {AdoptionControls,observeMutations}=await import('/control-kernel.mjs' as string),get=(id:string)=>document.getElementById(id) as HTMLInputElement;
  const input=get('text');input.setSelectionRange(2,7,'backward');let writes=0;
  const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!;
  Object.defineProperty(input,'value',{configurable:true,get(){return descriptor.get!.call(this);},set(value){writes++;descriptor.set!.call(this,value);}});
  const finishObservation=observeMutations();
  const controls=new AdoptionControls(get('host'));
  for(const [id,value]of [['text','saved'],['range',99],['number',7],['color','not-a-color'],['mail','  a@example.com  '],['area','saved notes']] as const)controls.add({element:get(id),key:'value',initial:value,...(id==='text'?{codec:'string'}:{})});
  const observed=controls.finish().map(({edited,value}:any)=>({edited,value}));controls.check();
  const observation=await finishObservation();
  const result={observed,writes,...observation,focus:document.activeElement===input,selection:[input.selectionStart,input.selectionEnd,input.selectionDirection]};controls.release();return result;
 });
 expect(result).toEqual({observed:[{edited:true,value:'typed before prepare'},{edited:false,value:'20'},{edited:false,value:'7'},{edited:false,value:'#000000'},{edited:false,value:'a@example.com'},{edited:false,value:'saved notes'}],writes:0,mutations:0,positive:1,focus:true,selection:[2,7,'backward']});
});
test('native select normalization preserves default winners and observes ordered multiple edits',async({page})=>{
 await serve(page,'<section id="host"><select id="single"><optgroup disabled><option value="disabled">D</option></optgroup><option value="a" selected>A</option><option value="a">duplicate A</option><option value="b">B</option></select><select id="multi" multiple><option value="a" selected>A</option><optgroup><option value="b">B</option><option value="c" selected>C</option></optgroup></select><select><option id="bool" value>label</option></select></section>');
 await page.locator('#multi').selectOption(['b','c']);
 const result=await page.evaluate(async()=>{
  const {AdoptionControls,observeMutations}=await import('/control-kernel.mjs' as string),get=(id:string)=>document.getElementById(id)!;
  const finishObservation=observeMutations();
  const controls=new AdoptionControls(get('host'));controls.add({element:get('single'),key:'value',initial:'a'});controls.add({element:get('multi'),key:'value',initial:['a','c'],codec:'string-array'});controls.add({element:get('bool'),key:'value',initial:true});
  const observed=controls.finish().map(({edited,value}:any)=>({edited,value}));controls.check();
  const result={observed,...await finishObservation(),singleIndex:(get('single') as HTMLSelectElement).selectedIndex,multiDefaults:[...(get('multi') as HTMLSelectElement).options].map(option=>option.defaultSelected)};controls.release();return result;
 });
 expect(result).toEqual({observed:[{edited:false,value:'a'},{edited:true,value:['b','c']},{edited:false,value:''}],mutations:0,positive:1,singleIndex:1,multiDefaults:[true,false,true]});
});
test('native boolean presence and coded default-before-edit refusal never repair controls',async({page})=>{
 await serve(page,'<section id="host"><input id="yes" value><input id="no"><input id="nil"><input id="edited" value="server"><input id="wrong" value="server"><input id="n" type="number" value="7"></section>');
 await page.locator('#edited').fill('user');await page.locator('#n').fill('');
 const result=await page.evaluate(async()=>{
  const {AdoptionControls,observeMutations}=await import('/control-kernel.mjs' as string),get=(id:string)=>document.getElementById(id)!;
  const finishObservation=observeMutations();
  const untouched=new AdoptionControls(get('host'));for(const [id,initial]of [['yes',true],['no',false],['nil',null]] as const)untouched.add({element:get(id),key:'value',initial});const values=untouched.finish().map(({edited,value}:any)=>({edited,value}));untouched.release();
  const bad=new AdoptionControls(get('host'));bad.add({element:get('edited'),key:'value',initial:'server'});bad.add({element:get('wrong'),key:'value',initial:'wrong'});let mismatch='';try{bad.finish();}catch(error){mismatch=(error as any).code;}bad.release();
  const number=new AdoptionControls(get('host'));number.add({element:get('n'),key:'value',initial:7,codec:'number'});let invalid='';try{number.finish();}catch(error){invalid=(error as any).code;}number.release();
  const result={values,mismatch,invalid,...await finishObservation(),text:(get('edited') as HTMLInputElement).value,number:(get('n') as HTMLInputElement).value};return result;
 });
 expect(result).toEqual({values:[{edited:false,value:''},{edited:false,value:''},{edited:false,value:''}],mismatch:'FORMA_E_HYDRATE_VALUE',invalid:'FORMA_E_HYDRATE_INPUT_TARGET',mutations:0,positive:1,text:'user',number:''});
});
test('external select peers and ordinary implicit defaults remain eligible while ambiguous winners refuse',async({page,browserName})=>{
 await serve(page,'<select><option id="plain">one</option><option>two</option></select><select><optgroup id="group"><option id="inside" selected>A</option></optgroup><option id="outside" selected>B</option></select><section id="ambiguous"><select><optgroup disabled><option id="disabled" value="d">D</option></optgroup><option id="enabled" value="a">A</option><option id="unaffected" value="b">B</option></select></section><section id="sized"><select size="2"><optgroup disabled><option value="d">D</option></optgroup><option id="sizeOption" value="a">A</option></select><select multiple><optgroup disabled><option value="d">D</option></optgroup><option id="multipleOption" value="a">A</option></select></section><section id="allDisabled"><select><optgroup disabled><option id="allDisabledFirst">A</option><option>B</option></optgroup></select></section>');
 const result=await page.evaluate(async()=>{
  const {AdoptionControls,observeMutations}=await import('/control-kernel.mjs' as string),get=(id:string)=>document.getElementById(id)!;
  const finishObservation=observeMutations();
  const plain=new AdoptionControls(get('plain'));plain.add({element:get('plain'),key:'selected',initial:false});const implicit=plain.finish().map(({edited,value}:any)=>({edited,value}));plain.check();plain.release();
  const group=new AdoptionControls(get('group'));group.add({element:get('inside'),key:'selected',initial:true});const grouped=group.finish().map(({edited,value}:any)=>({edited,value}));group.check();group.release();
  const codes=[];for(const id of ['disabled','enabled']){const controls=new AdoptionControls(get('ambiguous'));controls.add({element:get(id),key:'selected',initial:false,codec:'boolean'});try{controls.finish();codes.push('PASS');}catch(error){codes.push((error as any).code);}controls.release();}
  const unaffected=new AdoptionControls(get('ambiguous'));unaffected.add({element:get('unaffected'),key:'selected',initial:false});const other=unaffected.finish().map(({edited,value}:any)=>({edited,value}));unaffected.release();
  const sized=new AdoptionControls(get('sized'));for(const id of ['sizeOption','multipleOption'])sized.add({element:get(id),key:'selected',initial:false});const noImplicit=sized.finish().map(({edited,value}:any)=>({edited,value}));sized.release();
  const disabled=new AdoptionControls(get('allDisabled'));disabled.add({element:get('allDisabledFirst'),key:'selected',initial:false});const allDisabled=disabled.finish().map(({edited,value}:any)=>({edited,value}));disabled.release();
  const result={implicit,grouped,codes,other,noImplicit,allDisabled,...await finishObservation()};return result;
 });
 expect(result).toEqual({implicit:[{edited:false,value:true}],grouped:[{edited:false,value:false}],codes:['FORMA_E_HYDRATE_VALUE','FORMA_E_HYDRATE_VALUE'],other:[{edited:false,value:false}],noImplicit:[{edited:false,value:false},{edited:false,value:false}],allDisabled:[{edited:false,value:browserName==='webkit'}],mutations:0,positive:1});
});
