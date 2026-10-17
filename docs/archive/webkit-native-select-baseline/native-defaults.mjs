// One native-only baseline per current installed engine. No Forma module loaded.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from '../FORMA-playwright-transport/forma/node_modules/@playwright/test/index.mjs';
const source=readFileSync(new URL('./originals/adoption-controls.spec.ts',import.meta.url),'utf8');
const relevant=source.slice(source.indexOf("test('external select peers"));
const html=/await serve\(page,'([^']+)'\);/.exec(relevant)?.[1];assert(html&&!html.includes('\\'));
const rows=[];const output=new URL('./native-defaults.json',import.meta.url);
const persist=()=>writeFileSync(output,JSON.stringify({kind:'native baseline only',formaLoaded:false,fixtureSha256:createHash('sha256').update(html).digest('hex'),rows},null,2)+'\n');
for(const [name,engine]of Object.entries({chromium,firefox,webkit})){
 let browser;try{
  browser=await engine.launch({headless:true});const page=await browser.newPage();
  await page.route('http://forma.invalid/native',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head></head><body>${html}</body></html>`}));
  await page.goto('http://forma.invalid/native',{waitUntil:'load',timeout:15000});
  const observation=await page.evaluate(()=>{
   const read=select=>({index:select.selectedIndex,value:select.value,options:[...select.options].map(o=>({selected:o.selected,defaultSelected:o.defaultSelected,disabled:o.disabled,selectedAttribute:o.hasAttribute('selected')}))});
   const live=document.querySelector('#allDisabled select'),before=read(live);
   const doc=document.implementation.createHTMLDocument(),select=doc.createElement('select'),group=doc.createElement('optgroup');group.setAttribute('disabled','');select.appendChild(group);
   for(const label of ['A','B']){const option=doc.createElement('option');option.textContent=label;group.appendChild(option);}doc.body.appendChild(select);
   return {before,detachedMirror:read(select),after:read(live),plainSelected:document.querySelector('#plain').selected,scriptCount:document.scripts.length,userAgent:navigator.userAgent,platform:navigator.platform};
  });
  assert.deepEqual(observation.after,observation.before);assert.equal(observation.scriptCount,0);assert.equal(observation.plainSelected,true);
  rows.push({engine:name,version:browser.version(),executable:engine.executablePath(),observation});persist();
 }catch(error){rows.push({engine:name,error:String(error.stack??error)});persist();throw error;}
 finally{await browser?.close();}
}
console.log(JSON.stringify(rows.map(r=>({engine:r.engine,before:r.observation.before,mirror:r.observation.detachedMirror})),null,2));
