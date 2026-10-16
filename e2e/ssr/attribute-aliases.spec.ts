import {expect,test,type Route} from '@playwright/test';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {SSR_ORIGIN} from './origin';
test.beforeAll(async()=>{
  expect(await fetch(`${SSR_ORIGIN}/__site`).then(r=>r.json()))
    .toEqual({site:join(realpathSync(__dirname),'out','site'),built:true});
});
test('typed native attribute aliases match static, reactive and SVG browser writes',async({page})=>{
  const routes:Route[]=[],errors:string[]=[];let hold=true;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/_assets/*.js',route=>{if(hold)routes.push(route);else void route.continue();});
  const response=await page.goto(`${SSR_ORIGIN}/attribute-aliases/`,{waitUntil:'commit'});
  expect(response?.headers()['content-security-policy']).toContain("require-trusted-types-for 'script'");
  await page.waitForFunction(()=>document.readyState!=='loading');
  await expect.poll(()=>routes.length).toBeGreaterThan(0);
  await expect(page.locator('#static-label')).toHaveAttribute('class','static');
  await expect(page.locator('#static-label')).toHaveAttribute('for','field');
  await expect(page.locator('#static-label')).toHaveAttribute('tabindex','2');
  for(const id of ['dynamic-label','alias-svg']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('class','initial');
    await expect(page.locator(`#${id}`)).toHaveAttribute('for','field');
    await expect(page.locator(`#${id}`)).toHaveAttribute('tabindex','1');
  }
  await page.evaluate(()=>{
    const root=document.querySelector('#aliases')!,nodes:Node[]=[root],walker=document.createTreeWalker(root,NodeFilter.SHOW_ALL);
    for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
    const records:MutationRecord[]=[],events:unknown[]=[],violations:string[]=[];
    const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(document,{subtree:true,attributes:true,characterData:true,childList:true});
    document.addEventListener('forma:error',event=>events.push((event as CustomEvent).detail));
    document.addEventListener('securitypolicyviolation',event=>violations.push(event.violatedDirective));
    (window as any).__aliases={root,nodes,records,events,violations,observer};
  });
  hold=false;for(const route of routes.splice(0))await route.continue();await page.waitForLoadState('load');
  const adopted=await page.evaluate(async()=>{
    await new Promise(resolve=>setTimeout(resolve,0));
    const saved=(window as any).__aliases,root=document.querySelector('#aliases')!,nodes:Node[]=[root],walker=document.createTreeWalker(root,NodeFilter.SHOW_ALL);
    for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
    saved.records.push(...saved.observer.takeRecords());
    return {same:root===saved.root&&nodes.length===saved.nodes.length&&nodes.every((node,index)=>node===saved.nodes[index]),mutations:saved.records.length,events:saved.events,violations:saved.violations};
  });
  expect(adopted).toEqual({same:true,mutations:0,events:[],violations:[]});
  await page.locator('#update-aliases').click();
  for(const id of ['dynamic-label','alias-svg']) {
    const node=page.locator(`#${id}`);
    await expect(node).toHaveAttribute('class','changed');await expect(node).toHaveAttribute('for','other');await expect(node).toHaveAttribute('tabindex','4');
    expect(await node.evaluate(element=>[...element.attributes].map(attr=>attr.name))).not.toContain('classname');
    expect(await node.evaluate(element=>[...element.attributes].map(attr=>attr.name))).not.toContain('htmlfor');
  }
  expect(await page.locator('#dynamic-label').evaluate(element=>(element as HTMLLabelElement).control?.id)).toBe('other');
  await expect(page.locator('#dynamic-label')).toHaveAttribute('data-classname','unrelated');
  await expect(page.locator('#static-label')).toHaveAttribute('class','static');
  const after=await page.evaluate(async()=>{
    await new Promise(resolve=>setTimeout(resolve,0));const saved=(window as any).__aliases;
    saved.records.push(...saved.observer.takeRecords());saved.observer.disconnect();
    return {observed:saved.records.length,events:saved.events,violations:saved.violations};
  });
  expect(after.observed).toBeGreaterThan(0);expect(after.events).toEqual([]);expect(after.violations).toEqual([]);expect(errors).toEqual([]);
});
