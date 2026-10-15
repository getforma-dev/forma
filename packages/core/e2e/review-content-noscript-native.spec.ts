import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
let moduleText='';
test.beforeAll(async()=>{
 const dir=fileURLToPath(new URL('../src/dom/',import.meta.url));
 const result=await build({stdin:{contents:`export {prepareStyle,prepareRaw} from './adoption-content';export {trustedHtml} from './trusted-html';`,resolveDir:dir},bundle:true,write:false,format:'esm',platform:'browser',define:{__FORMA_DEV_BUILD__:'false'},logLevel:'silent'});
 moduleText=result.outputFiles[0]!.text;
});
test('raw HTML noscript has an explicit private preparation refusal without changing served content',async({page})=>{
 await page.route('**/content-review.mjs',r=>r.fulfill({contentType:'text/javascript',body:moduleText}));
 await page.route('**/content-review.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><noscript id="target"><br/></noscript>'}));
 await page.goto('/content-review.html');
 const result=await page.evaluate(async()=>{
  const {prepareRaw,trustedHtml}=await import('/content-review.mjs' as string),element=document.getElementById('target')!;
  const original=element.firstChild;let code='PASS';try{prepareRaw(element,{__html:trustedHtml('<br/>')});}catch(error){code=(error as any).code??String(error)}
  return{code,same:element.firstChild===original,html:element.innerHTML,type:element.firstChild?.nodeType};
 });
 expect(result).toEqual({code:'FORMA_E_HYDRATE_STRUCTURE',same:true,html:'<br/>',type:3});
});
