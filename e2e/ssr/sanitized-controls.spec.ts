import {expect,test,type Page,type Route} from '@playwright/test';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {SSR_ORIGIN} from './origin';

const vectors = [
  {type:'color',server:'not-a-color',normalized:'#000000',edit:'#123456',later:'#abcdef'},
  {type:'range',server:'99',normalized:'20',edit:'15',later:'12'},
  {type:'email',server:'  saved@example.test  ',normalized:'saved@example.test',edit:'typed@example.test',later:'later@example.test'},
  {type:'number',server:'not-a-number',normalized:'',edit:'13',later:'42'},
  {type:'date',server:'2026-02-30',normalized:'',edit:'2026-10-16',later:'2026-11-20'},
  {type:'time',server:'25:99',normalized:'',edit:'14:25',later:'18:40'},
  {type:'url',server:'  https://forma.test/saved  ',normalized:'https://forma.test/saved',edit:'https://forma.test/typed',later:'https://forma.test/later'},
] as const;
test.use({baseURL:SSR_ORIGIN});
test.beforeAll(async()=>{
  const site=await fetch(`${SSR_ORIGIN}/__site`).then(r=>r.json());
  expect(site).toEqual({site:join(realpathSync(__dirname),'out','site'),built:true});
});
async function held(page:Page) {
  const routes:Route[]=[],errors:string[]=[];
  let hold=true;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/_assets/*.js',r=>{if(hold)routes.push(r);else void r.continue();});
  const response=await page.goto('/sanitized-controls/',{waitUntil:'commit'});
  expect(response?.headers()['content-security-policy']).toContain("require-trusted-types-for 'script'");
  await page.waitForFunction(()=>document.readyState!=='loading');
  await expect.poll(()=>routes.length).toBeGreaterThan(0);
  return {errors,async activate(){hold=false;for(const route of routes.splice(0))await route.continue();await page.waitForLoadState('load');}};
}

// Fourteen product cases × Chromium/Firefox/WebKit =42 acceptance controls.
for(const vector of vectors)for(const edited of [false,true])test(`${vector.type}: ${edited?'early edit seeds its signal':'sanitized server default is not an edit'}`,async({page})=>{
  const gate=await held(page),input=page.locator(`#${vector.type}`),echo=page.locator(`#echo-${vector.type}`);
  await expect(input).toHaveAttribute('value',vector.server);
  await expect(input).toHaveValue(vector.normalized);
  expect(await echo.textContent()).toBe(vector.server);
  if(edited) {
    if(vector.type==='color'||vector.type==='range') {
      // Native color pickers and range sliders are not text-fillable. Model
      // their pre-module browser/autofill property write and input event.
      await input.evaluate((element,value)=>{const field=element as HTMLInputElement;field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));},vector.edit);
    } else await input.fill(vector.edit);
    await expect(input).toHaveValue(vector.edit);
  }
  await input.focus();
  await input.evaluate((element,type)=>{
    const field=element as HTMLInputElement;
    if(type==='url')field.setSelectionRange(2,7,'backward');
    const saved={element:field,value:field.value,selection:[field.selectionStart,field.selectionEnd,field.selectionDirection],writes:0,
      records:[] as MutationRecord[],events:[] as unknown[],violations:[] as string[]};
    const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!;
    Object.defineProperty(field,'value',{configurable:true,get(){return descriptor.get!.call(this);},set(value){saved.writes++;descriptor.set!.call(this,value);}});
    const observer=new MutationObserver(records=>saved.records.push(...records));
    observer.observe(document,{subtree:true,attributes:true,childList:true,characterData:true});
    document.addEventListener('forma:error',e=>saved.events.push((e as CustomEvent).detail));
    document.addEventListener('securitypolicyviolation',e=>saved.violations.push(e.violatedDirective));
    (window as any).__sanitized={saved,observer};
  },vector.type);
  await gate.activate();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  const beforeUpdate=await page.evaluate(()=>{
    const {saved,observer}=(window as any).__sanitized;
    saved.records.push(...observer.takeRecords());
    const element=saved.element as HTMLInputElement;
    return {sameNode:document.getElementById(element.id)===element,value:element.value,savedValue:saved.value,
      selection:[element.selectionStart,element.selectionEnd,element.selectionDirection],savedSelection:saved.selection,
      focus:document.activeElement===element,writes:saved.writes,mutations:saved.records.length,
      inputMutations:saved.records.filter((record:MutationRecord)=>record.target===element).length,
      events:saved.events,violations:saved.violations};
  });
  expect(beforeUpdate).toMatchObject({sameNode:true,value:edited?vector.edit:vector.normalized,savedValue:edited?vector.edit:vector.normalized,
    focus:true,writes:0,inputMutations:0,events:[],violations:[]});
  expect(beforeUpdate.selection).toEqual(beforeUpdate.savedSelection);
  if(!edited)expect(beforeUpdate.mutations).toBe(0);
  expect(await echo.textContent()).toBe(edited?vector.edit:vector.server);
  await expect(page.locator('[data-forma-status="error"]')).toHaveCount(0);
  // Prove the same observer was live after freezing the measured phase.
  const positive=await page.evaluate(async()=>{
    const {saved,observer}=(window as any).__sanitized,before=saved.records.length;
    saved.element.setAttribute('data-observer-control','observed');
    await new Promise(resolve=>setTimeout(resolve,0));
    saved.records.push(...observer.takeRecords());observer.disconnect();
    return saved.records.slice(before).map((record:MutationRecord)=>({type:record.type,name:record.attributeName,target:record.target===saved.element}));
  });
  expect(positive).toEqual([{type:'attributes',name:'data-observer-control',target:true}]);
  // A dead activation must fail this paired behavior control, even when the
  // static DOM and empty error list alone look correct.
  await page.locator(`#set-${vector.type}`).click();
  await expect(input).toHaveValue(vector.later);
  expect(await echo.textContent()).toBe(vector.later);
  expect(gate.errors).toEqual([]);
});
