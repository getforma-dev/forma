import {expect,test,type Route} from '@playwright/test';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {SSR_ORIGIN} from './origin';

test.beforeAll(async()=>{
  expect(await fetch(`${SSR_ORIGIN}/__site`).then(r=>r.json()))
    .toEqual({site:join(realpathSync(__dirname),'out','site'),built:true});
});
test('native element ternaries retain their nodes without writes and own later branch listeners',async({page})=>{
  const routes:Route[]=[],errors:string[]=[];
  let hold=true;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/_assets/*.js',route=>{if(hold)routes.push(route);else void route.continue();});
  const response=await page.goto(`${SSR_ORIGIN}/conditional-element/`,{waitUntil:'commit'});
  expect(response?.headers()['content-security-policy']).toContain("require-trusted-types-for 'script'");
  await page.waitForFunction(()=>document.readyState!=='loading');
  await expect.poll(()=>routes.length).toBeGreaterThan(0);
  await expect(page.locator('[data-case="selected"] .branch')).toHaveCount(1);
  await expect(page.locator('[data-case="empty"] .branch')).toHaveCount(0);
  await page.evaluate(()=>{
    const nodes:Node[]=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_ALL);
    for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
    const records:MutationRecord[]=[],events:unknown[]=[],violations:string[]=[];
    const observer=new MutationObserver(batch=>records.push(...batch));
    observer.observe(document,{subtree:true,attributes:true,characterData:true,childList:true});
    document.addEventListener('forma:error',event=>events.push((event as CustomEvent).detail));
    document.addEventListener('securitypolicyviolation',event=>violations.push(event.violatedDirective));
    (window as any).__conditional={nodes,records,observer,events,violations};
  });
  hold=false;for(const route of routes.splice(0))await route.continue();
  await page.waitForLoadState('load');
  const adoption=await page.evaluate(async()=>{
    await new Promise(resolve=>setTimeout(resolve,0));
    const saved=(window as any).__conditional,nodes:Node[]=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_ALL);
    for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
    saved.records.push(...saved.observer.takeRecords());
    return {same:nodes.length===saved.nodes.length&&nodes.every((node,i)=>node===saved.nodes[i]),
      mutations:saved.records.length,events:saved.events,violations:saved.violations};
  });
  expect(adoption).toEqual({same:true,mutations:0,events:[],violations:[]});
  await expect(page.locator('[data-forma-status="error"]')).toHaveCount(0);
  for(const label of ['selected','empty']) {
    const section=page.locator(`[data-case="${label}"]`),branch=section.locator('.branch'),toggle=section.locator('.toggle');
    if(label==='empty')await toggle.click();
    await expect(branch).toHaveCount(1);
    await branch.click();await expect(section.locator('output')).toHaveText('1');
    await branch.evaluate(element=>{(window as any).__retiredBranch=element;});
    await toggle.click();await expect(branch).toHaveCount(0);
    // A removed generation must have relinquished its listener ownership.
    await page.evaluate(()=>(window as any).__retiredBranch.click());
    await expect(section.locator('output')).toHaveText('1');
    await toggle.click();await expect(branch).toHaveCount(1);
    expect(await branch.evaluate(element=>element!==(window as any).__retiredBranch)).toBe(true);
    await branch.click();await expect(section.locator('output')).toHaveText('2');
  }
  const after=await page.evaluate(async()=>{
    await new Promise(resolve=>setTimeout(resolve,0));
    const saved=(window as any).__conditional;saved.records.push(...saved.observer.takeRecords());saved.observer.disconnect();
    return {observed:saved.records.length,events:saved.events,violations:saved.violations};
  });
  expect(after.observed).toBeGreaterThan(0); // The same observer sees the real updates.
  expect(after.events).toEqual([]);expect(after.violations).toEqual([]);expect(errors).toEqual([]);
});
