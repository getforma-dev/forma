import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
let moduleText='';
test.beforeAll(async()=>{
 const dir=fileURLToPath(new URL('../src/dom/',import.meta.url));
 const result=await build({stdin:{contents:`export {prepareStyle,prepareRaw} from './adoption-content';export {prepareAttribute} from './adoption-attributes';export {trustedHtml} from './trusted-html';`,resolveDir:dir},bundle:true,write:false,format:'esm',platform:'browser',define:{__FORMA_DEV_BUILD__:'false'},logLevel:'silent'});
 moduleText=result.outputFiles[0]!.text+`
 export function observeMutations(){
  const records=[];const observer=new MutationObserver(batch=>records.push(...batch));
  observer.observe(document,{subtree:true,attributes:true,childList:true,characterData:true});
  return async()=>{await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());const mutations=records.length;records.length=0;document.documentElement.setAttribute('data-observer-control','present');await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());observer.disconnect();return{mutations,positive:records.filter(r=>r.type==='attributes'&&r.target===document.documentElement&&r.attributeName==='data-observer-control').length};};
 }
 `;
});
async function serve(page:Page,html:string){
 const hashes=[...html.matchAll(/ style="([^"]*)"/g)].map(match=>`'sha256-${createHash('sha256').update(match[1]!).digest('base64')}'`);
 await page.route('**/adoption-content.mjs',route=>route.fulfill({contentType:'text/javascript',body:moduleText}));
 await page.route('**/adoption-content.html',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':`default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-hashes' ${hashes.join(' ')}; frame-src 'self'; require-trusted-types-for 'script'; trusted-types forma forma-runtime forma-frame`},body:`<!doctype html><html><head></head><body>${html}</body></html>`}));
 await page.goto('/adoption-content.html');
 await page.evaluate(()=>{(window as any).violations=[];document.addEventListener('securitypolicyviolation',event=>(window as any).violations.push(event.violatedDirective));});
}
test('normalizes served CSS without initial writes and later reconciles only declarations under CSP',async({page})=>{
 await serve(page,'<div id="s" style="font-size:14px; color:red"><b>kept</b></div><div id="o" style="opacity:0.5; color:red"></div>');
 const result=await page.evaluate(async()=>{
  const {prepareStyle,observeMutations}=await import('/adoption-content.mjs' as string),el=document.getElementById('s') as HTMLElement,obj=document.getElementById('o') as HTMLElement,first=el.firstChild;
  const descriptor=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,'cssText')!;let blockWrites=0,attrWrites=0;
  Object.defineProperty(el.style,'cssText',{configurable:true,get(){return descriptor.get!.call(this);},set(value){blockWrites++;descriptor.set!.call(this,value);}});const setAttribute=el.setAttribute;el.setAttribute=function(...args){attrWrites++;return setAttribute.apply(this,args);};
  const finish=observeMutations(),style=prepareStyle(el,'color: red; font-size:14px'),object=prepareStyle(obj,{opacity:0.5,color:'red'});style.write('font-size:14px;color:red');const observation=await finish(),initialSame=el.firstChild===first;
  style.write('font-size:16px;color:blue');object.write({opacity:1});style.write(null);const later=[el.style.color,el.style.fontSize,obj.style.color,obj.style.opacity];style.write('');
  await new Promise(resolve=>setTimeout(resolve,0));return{...observation,initialSame,blockWrites,attrWrites,later,empty:el.style.length,violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,initialSame:true,blockWrites:0,attrWrites:0,later:['blue','16px','','1'],empty:0,violations:[]});
});
test('CSS mismatches, reserved block keys and object accessors refuse without a repair or coercion',async({page})=>{
 await serve(page,'<div id="s"></div>');
 const result=await page.evaluate(async()=>{
  const {prepareStyle,observeMutations}=await import('/adoption-content.mjs' as string),el=document.getElementById('s')!,finish=observeMutations();let calls=0;
  const getter=Object.defineProperty({},'color',{enumerable:true,get(){calls++;return'red';}}),codes=[];
  for(const value of ['color:red',{color:'red'},getter,{color:{toString(){calls++;return'red';}}},{cssText:'color:red'},'css-text:color:red',{opacity:Infinity}]){try{prepareStyle(el,value);codes.push('PASS');}catch(error){codes.push((error as any).code);}}
  return{...await finish(),calls,codes,style:el.getAttribute('style'),violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,calls:0,codes:Array(7).fill('FORMA_E_HYDRATE_VALUE'),style:null,violations:[]});
});
test('typed raw normalization uses table tbody and SVG context without rewriting served nodes',async({page})=>{
 await serve(page,'<table id="table"><tr><td>A</td></tr></table><table><tbody id="body"><tr><td>B</td></tr></tbody></table><svg><g id="svg"><circle cx="1" cy="2"/></g></svg>');
 const result=await page.evaluate(async()=>{
  const {prepareRaw,trustedHtml,observeMutations}=await import('/adoption-content.mjs' as string),finish=observeMutations(),observed=[];
  for(const[id,markup]of [['table','<tr><td>A</td></tr>'],['body','<tr><td>B</td></tr>'],['svg',"<circle cx='1' cy='2'/>"]]){const el=document.getElementById(id)!,first=el.firstChild,value={__html:trustedHtml(markup)},plan=prepareRaw(el,value);plan.write(value);observed.push({owns:plan.ownsContent,same:el.firstChild===first,namespace:el.firstElementChild!.namespaceURI});}
  return{...await finish(),observed,violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,observed:[{owns:true,same:true,namespace:'http://www.w3.org/1999/xhtml'},{owns:true,same:true,namespace:'http://www.w3.org/1999/xhtml'},{owns:true,same:true,namespace:'http://www.w3.org/2000/svg'}],violations:[]});
});
test('raw marker-like comments are opaque and detached normalization runs no custom constructors',async({page})=>{
 await serve(page,'<div id="raw"><!--f:l7--><x-adoption-raw>kept</x-adoption-raw><!--/f:t3--></div>');
 const result=await page.evaluate(async()=>{
  const {prepareRaw,trustedHtml,observeMutations}=await import('/adoption-content.mjs' as string);let constructors=0;customElements.define('x-adoption-raw',class extends HTMLElement{constructor(){super();constructors++;}});constructors=0;
  const el=document.getElementById('raw')!,first=el.firstChild,finish=observeMutations();const plan=prepareRaw(el,{__html:trustedHtml('<!--f:l7--><x-adoption-raw>kept</x-adoption-raw><!--/f:t3-->')});
  return{...await finish(),constructors,owns:plan.ownsContent,same:el.firstChild===first,violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,constructors:0,owns:true,same:true,violations:[]});
});
test('typed raw mismatches and lookalikes refuse before parsing, cache and teardown',async({page})=>{
 await serve(page,'<div id="raw"><b>A</b></div><div id="empty"></div>');
 const result=await page.evaluate(async()=>{
  const {prepareRaw,trustedHtml,observeMutations}=await import('/adoption-content.mjs' as string),el=document.getElementById('raw')!,finish=observeMutations(),plan=prepareRaw(el,{__html:trustedHtml('<b>A</b>')});let calls=0,teardowns=0;const codes=[];
  for(const bad of [{__html:'<b>A</b>'},{__html:{toString(){calls++;return'<b>A</b>';}}},Object.create({__html:trustedHtml('<b>A</b>')}),Object.defineProperty({},'__html',{get(){calls++;return trustedHtml('<b>A</b>');}})]){try{plan.write(bad,()=>teardowns++);codes.push('PASS');}catch(error){codes.push(String(error).includes('FORMA_E_RAW_INNER_HTML'));}}
  for(const target of [el,document.getElementById('empty')!]){try{prepareRaw(target,{__html:trustedHtml('<i>different</i>')});codes.push('PASS');}catch(error){codes.push((error as any).code);}}
  return{...await finish(),codes,calls,teardowns,html:el.innerHTML,empty:document.getElementById('empty')!.innerHTML,violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,codes:[true,true,true,true,'FORMA_E_HYDRATE_VALUE','FORMA_E_HYDRATE_VALUE'],calls:0,teardowns:0,html:'<b>A</b>',empty:'',violations:[]});
});
test('fallback is initially untouched and later typed transitions dispose only before real changes',async({page})=>{
 await serve(page,'<div id="raw"><b>fallback</b></div>');
 const result=await page.evaluate(async()=>{
  const {prepareRaw,trustedHtml,observeMutations}=await import('/adoption-content.mjs' as string),el=document.getElementById('raw')!,first=el.firstChild,finish=observeMutations(),plan=prepareRaw(el,null);const initialSame=el.firstChild===first,observation=await finish(),calls:string[]=[],before=()=>calls.push(el.innerHTML),value={__html:trustedHtml('<i>next</i>')};
  plan.write(null,before);plan.write(value,before);const updated=el.firstChild;plan.write(value,before);const same=el.firstChild===updated;plan.write(false,before);plan.write(value,before);await new Promise(resolve=>setTimeout(resolve,0));return{...observation,owns:plan.ownsContent,initialSame,same,calls,html:el.innerHTML,violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,owns:false,initialSame:true,same:true,calls:['<b>fallback</b>','','<i>next</i>',''],html:'<i>next</i>',violations:[]});
});
test('prepared iframe srcdoc preserves typed writes and refuses a same-text string before cache',async({page})=>{
 await serve(page,'<iframe id="frame" srcdoc="&lt;p&gt;A&lt;/p&gt;"></iframe>');
 const result=await page.evaluate(async()=>{
  const {prepareAttribute,trustedHtml,observeMutations}=await import('/adoption-content.mjs' as string),el=document.getElementById('frame')!,finish=observeMutations(),value=trustedHtml('<p>A</p>'),plan=prepareAttribute(el,'srcdoc',value);plan.write(value);let refused=false;try{plan.write('<p>A</p>');}catch(error){refused=String(error).includes('FORMA_E_RAW_SRCDOC');}
  const observation=await finish();plan.write(trustedHtml('<p>B</p>'));const next=el.getAttribute('srcdoc');plan.write(false);const removed=!el.hasAttribute('srcdoc');plan.write(value);await new Promise(resolve=>setTimeout(resolve,0));return{...observation,initial:plan.initial,refused,next,removed,final:el.getAttribute('srcdoc'),violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,initial:'<p>A</p>',refused:true,next:'<p>B</p>',removed:true,final:'<p>A</p>',violations:[]});
});
test('native policy control proves plain HTML is refused where Trusted Types is supported',async({page})=>{
 await serve(page,'<div id="sink"></div>');
 const result=await page.evaluate(async()=>{const supported=!!(window as any).trustedTypes;let refused=false;try{document.getElementById('sink')!.innerHTML='<b>plain</b>';}catch{refused=true;}await new Promise(resolve=>setTimeout(resolve,0));return{supported,refused,violations:(window as any).violations};});
 expect(result.refused).toBe(result.supported);if(result.supported)expect(result.violations).toContain('require-trusted-types-for');else expect(result.violations).toEqual([]);
});
test('contextual raw normalization retains ancestor form and MathML integration context',async({page})=>{
 await serve(page,'<form><div id="form"><form><input name="x"></form></div></form><math><annotation-xml id="math" encoding="text/html"><a href="/x">kept</a></annotation-xml></math>');
 const result=await page.evaluate(async()=>{
  const {prepareRaw,trustedHtml,observeMutations}=await import('/adoption-content.mjs' as string),finish=observeMutations(),results=[];
  for(const [id,markup]of [['form','<form><input name="x"></form>'],['math','<a href="/x">kept</a>']]){const el=document.getElementById(id)!,first=el.firstChild;let code='PASS';try{prepareRaw(el,{__html:trustedHtml(markup)});}catch(error){code=(error as any).code;}results.push({id,code,same:el.firstChild===first,html:el.innerHTML,namespace:el.firstElementChild?.namespaceURI});}
  return{...await finish(),results,violations:(window as any).violations};
 });
 expect(result).toEqual({mutations:0,positive:1,results:[{id:'form',code:'PASS',same:true,html:'<input name="x">',namespace:'http://www.w3.org/1999/xhtml'},{id:'math',code:'PASS',same:true,html:'<a href="/x">kept</a>',namespace:'http://www.w3.org/1999/xhtml'}],violations:[]});
});
