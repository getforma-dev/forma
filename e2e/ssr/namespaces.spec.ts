import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {expect,test,type Page,type Route} from '@playwright/test';
import {SSR_ORIGIN as ORIGIN} from './origin';

// Frozen shared native/browser namespace vectors from FORMA-182.
const vectors=JSON.parse(readFileSync(join(__dirname,'../../crates/forma-ir/tests/fixtures/parity/namespaces.json'),'utf8')).vectors.filter((vector:{name:string})=>!vector.name.includes('script'));
test.use({baseURL:ORIGIN});
test.beforeAll(async()=>{
  const site=await fetch(`${ORIGIN}/__site`).then(response=>response.json());
  expect(site.site).toBe(join(realpathSync(__dirname),'out/site'));expect(site.built).toBe(true);expect(vectors).toHaveLength(6);
});
async function assertVectors(page:Page){
  const actual=await page.locator('[data-vector]').evaluateAll(elements=>elements.map(element=>({
    name:element.getAttribute('data-vector'),
    namespaces:[...element.querySelectorAll('*')].map(node=>`${node.localName}:${node.namespaceURI==='http://www.w3.org/2000/svg'?'svg':node.namespaceURI==='http://www.w3.org/1998/Math/MathML'?'mathml':'html'}`),
  })));
  expect(actual).toEqual(vectors.map((vector:{name:string;namespaces:string[]})=>({name:vector.name,namespaces:vector.namespaces})));
}
function errors(page:Page){const found:string[]=[];page.on('pageerror',error=>found.push(error.message));page.on('console',message=>{if(message.type()==='error')found.push(message.text())});return found;}
test('actual typed native products parse to the six canonical namespace trees',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});try{const page=await context.newPage();await page.goto(`${ORIGIN}/namespaces/`);await expect(page.locator('[data-forma-island="NamespaceVectors"]')).toHaveCount(1);await assertVectors(page);}finally{await context.close();}
});
test('compiled fresh JSX preserves namespace vectors and the script refusal',async({page})=>{
  const seen=errors(page);await page.goto('/namespaces/csr');await expect(page.locator('#namespace-root')).toHaveCount(1);await assertVectors(page);
  await page.locator('#namespace-update').click();await expect(page.locator('#namespace-live')).toHaveText('updated');await expect(page.locator('#namespace-live')).toHaveAttribute('title','updated');
  const source=await page.locator('script[type="module"][src]').last().getAttribute('src');expect(source).toBeTruthy();
  const refusal=await page.evaluate(async source=>{const module=await import(source!);try{module.forbiddenScript();return null}catch(error){return String(error)}},source);
  expect(refusal).toContain('FORMA_E_SCRIPT_ELEMENT');expect(seen).toEqual([]);
});
test('compiled namespaces adopt the same nodes with zero writes and live signal bindings',async({page})=>{
  const seen=errors(page),held:Route[]=[];let holding=true;
  await page.addInitScript(()=>{(window as any).__namespaceErrors=[];document.addEventListener('forma:error',event=>(window as any).__namespaceErrors.push((event as CustomEvent).detail))});
  await page.route('**/_assets/*.js',route=>{if(holding)held.push(route);else void route.continue()});
  await page.goto('/namespaces/',{waitUntil:'commit'});await page.waitForFunction(()=>document.readyState!=='loading');await expect.poll(()=>held.length).toBeGreaterThan(0);await assertVectors(page);
  await page.evaluate(()=>{const root=document.querySelector('#namespace-root')!;(window as any).__namespaceNodes=[root,...root.querySelectorAll('*')];(window as any).__namespaceWrites=[];const observer=new MutationObserver(records=>(window as any).__namespaceWrites.push(...records.map(record=>record.type)));observer.observe(root,{subtree:true,attributes:true,characterData:true,childList:true});(window as any).__namespaceObserver=observer});
  holding=false;for(const route of held.splice(0))await route.continue();await page.waitForLoadState('load');
  const initial=await page.evaluate(()=>{const w=window as any;w.__namespaceWrites.push(...w.__namespaceObserver.takeRecords().map((record:MutationRecord)=>record.type));const root=document.querySelector('#namespace-root')!;return {errors:w.__namespaceErrors,writes:w.__namespaceWrites,kept:[root,...root.querySelectorAll('*')].every((node,index)=>node===w.__namespaceNodes[index])}});
  expect(initial).toEqual({errors:[],writes:[],kept:true});await assertVectors(page);
  await page.locator('#namespace-update').click();await expect(page.locator('#namespace-live')).toHaveText('updated');await expect(page.locator('#namespace-live')).toHaveAttribute('title','updated');
  const updated=await page.evaluate(()=>{const w=window as any;w.__namespaceWrites.push(...w.__namespaceObserver.takeRecords().map((record:MutationRecord)=>record.type));w.__namespaceObserver.disconnect();return {writes:w.__namespaceWrites,kept:w.__namespaceNodes.every((node:Node)=>node.isConnected),errors:w.__namespaceErrors}});
  expect(updated.kept).toBe(true);expect(updated.errors).toEqual([]);expect(updated.writes).toHaveLength(2);expect(seen).toEqual([]);
});
