import {expect,test,type Route} from '@playwright/test';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {SSR_ORIGIN} from './origin';
test.beforeAll(async()=>expect(await fetch(`${SSR_ORIGIN}/__site`).then(r=>r.json())).toEqual({site:join(realpathSync(__dirname),'out','site'),built:true}));
for(const mode of ['native','browser'])test(`${mode}: foreign attribute identity and integration points remain live`,async({page})=>{
  const errors:string[]=[],held:Route[]=[];let release=mode==='browser';
  const cursor=await fetch(`${SSR_ORIGIN}/__csp-reports`).then(response=>response.json()).then(report=>report.cursor as number);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>{(window as any).__foreignErrors=[];document.addEventListener('forma:error',event=>(window as any).__foreignErrors.push((event as CustomEvent).detail));document.addEventListener('securitypolicyviolation',event=>(window as any).__foreignErrors.push(event.violatedDirective));});
  await page.route('**/_assets/*.js',route=>release?route.continue():void held.push(route));
  const response=await page.goto(`${SSR_ORIGIN}/foreign-attributes/${mode==='browser'?'csr':''}`,{waitUntil:mode==='native'?'commit':'load'});
  expect(response?.headers()['content-security-policy']).toContain("require-trusted-types-for 'script'");
  if(mode==='native'){
    await page.waitForFunction(()=>document.readyState!=='loading');await expect.poll(()=>held.length).toBeGreaterThan(0);
    await page.evaluate(()=>{
      const root=document.querySelector('#foreign-attributes')!,nodes:Node[]=[root],walker=document.createTreeWalker(root,NodeFilter.SHOW_ALL);
      for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
      const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});
      (window as any).__foreignAdoption={root,nodes,records,observer};
    });
    release=true;for(const route of held.splice(0))await route.continue();await page.waitForLoadState('load');
    expect(await page.evaluate(async()=>{
      await new Promise(resolve=>setTimeout(resolve,0));const saved=(window as any).__foreignAdoption,root=document.querySelector('#foreign-attributes')!,nodes:Node[]=[root],walker=document.createTreeWalker(root,NodeFilter.SHOW_ALL);
      for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
      saved.records.push(...saved.observer.takeRecords());saved.observer.disconnect();
      return {retained:root===saved.root&&nodes.length===saved.nodes.length&&nodes.every((node,index)=>node===saved.nodes[index]),writes:saved.records.length};
    })).toEqual({retained:true,writes:0});
  }
  const snapshot=()=>page.evaluate(()=>{
    const svg=document.querySelector('#foreign-svg')!,xlink=document.querySelector('#foreign-xlink')!,math=document.querySelector('#foreign-math')!;
    const nestedSvg=document.querySelector('#xml-svg')!;
    return {svgNS:svg.namespaceURI,viewBox:svg.getAttribute('viewBox'),wrongViewBox:svg.getAttribute('viewbox'),ratio:svg.getAttribute('preserveAspectRatio'),label:svg.getAttribute('class'),xlink:xlink.getAttributeNS('http://www.w3.org/1999/xlink','title'),nullXlink:xlink.getAttributeNS(null,'xlink:title'),mathNS:math.namespaceURI,definition:math.getAttribute('definitionURL'),wrongDefinition:math.getAttribute('definitionurl'),nestedSvg:[nestedSvg.namespaceURI,nestedSvg.getAttribute('viewBox')],html:['svg-html','math-html'].map(id=>{const el=document.getElementById(id)!;return [el.namespaceURI,el.getAttribute('tabindex'),el.getAttribute('data-label')];})};
  });
  const initial={svgNS:'http://www.w3.org/2000/svg',viewBox:'0 0 100 100',wrongViewBox:null,ratio:'xMidYMid meet',label:'initial',xlink:'initial',nullXlink:null,mathNS:'http://www.w3.org/1998/Math/MathML',definition:'original',wrongDefinition:null,nestedSvg:['http://www.w3.org/2000/svg','0 0 10 10'],html:Array.from({length:2},()=>['http://www.w3.org/1999/xhtml','1','initial'])};
  expect(await snapshot()).toEqual(initial);await page.locator('#update-foreign').click();
  expect(await snapshot()).toEqual({...initial,label:'changed',xlink:'changed',definition:'updated',html:Array.from({length:2},()=>['http://www.w3.org/1999/xhtml','1','changed'])});
  expect(await page.evaluate(()=>(window as any).__foreignErrors)).toEqual([]);expect(errors).toEqual([]);
  const reports=await fetch(`${SSR_ORIGIN}/__csp-reports?after=${cursor}`).then(response=>response.json());
  expect(reports.reports.filter((report:{document:string})=>report.document===`/foreign-attributes/${mode==='browser'?'csr':''}`)).toEqual([]);
});
