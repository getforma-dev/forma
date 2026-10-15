import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
let moduleText='';
test.beforeAll(async()=>{
 const dir=fileURLToPath(new URL('../src/dom/',import.meta.url));
 const result=await build({stdin:{contents:`export {prepareStyle,prepareRaw} from './adoption-content';export {trustedHtml} from './trusted-html';`,resolveDir:dir},bundle:true,write:false,format:'esm',platform:'browser',define:{__FORMA_DEV_BUILD__:'false'},logLevel:'silent'});
 moduleText=result.outputFiles[0]!.text;
});
test('a prepared raw template clears its actual content and tears it down once',async({page})=>{
 await page.route('**/content-review.mjs',r=>r.fulfill({contentType:'text/javascript',body:moduleText}));
 await page.route('**/content-review.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><template id="target"><b>A</b></template>'}));
 await page.goto('/content-review.html');
 const result=await page.evaluate(async()=>{
  const {prepareRaw,trustedHtml}=await import('/content-review.mjs' as string),element=document.getElementById('target') as HTMLTemplateElement;
  const original=element.content.firstChild,plan=prepareRaw(element,{__html:trustedHtml('<b>A</b>')});
  const unchanged=element.content.firstChild===original;let teardowns=0;
  plan.write(false,()=>teardowns++);plan.write(false,()=>teardowns++);
  return{owns:plan.ownsContent,unchanged,html:element.innerHTML,children:element.content.childNodes.length,teardowns};
 });
 expect(result).toEqual({owns:true,unchanged:true,html:'',children:0,teardowns:1});
});
