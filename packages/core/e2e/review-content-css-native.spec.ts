import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
let moduleText='';
test.beforeAll(async()=>{
 const dir=fileURLToPath(new URL('../src/dom/',import.meta.url));
 const result=await build({stdin:{contents:`export {prepareStyle,prepareRaw} from './adoption-content';export {trustedHtml} from './trusted-html';`,resolveDir:dir},bundle:true,write:false,format:'esm',platform:'browser',define:{__FORMA_DEV_BUILD__:'false'},logLevel:'silent'});
 moduleText=result.outputFiles[0]!.text;
});
test('an ignored invalid CSS update cannot make a later explicit clear a cache no-op',async({page})=>{
 await page.route('**/content-review.mjs',r=>r.fulfill({contentType:'text/javascript',body:moduleText}));
 await page.route('**/content-review.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="target" style="color:red"></div>'}));
 await page.goto('/content-review.html');
 const result=await page.evaluate(async()=>{
  const {prepareStyle}=await import('/content-review.mjs' as string),element=document.getElementById('target') as HTMLElement;
  const style=prepareStyle(element,'color:red');style.write('color:not-a-color');const ignored=element.style.color;
  style.write('');return{ignored,cleared:element.style.color,length:element.style.length};
 });
 expect(result).toEqual({ignored:'red',cleared:'',length:0});
});
