// Finite diagnostic only. Never a release/performance acceptance producer.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {digest} from './release-set.mjs';
import {prepareCandidate} from './candidate-scaffold.mjs';
import {stageFixtureProject} from './release-fixture-apps.mjs';
import {withOwnedServer} from './owned-server.mjs';
import {measureActivation,activationInstrumentation,MOBILE_PROFILE} from './release-performance-mobile.mjs';
const base=process.env.RUNNER_TEMP,output=join(base,'diagnostic-219'),dir=join(base,'rc3-packed');
mkdirSync(output);const save=(name,value)=>writeFileSync(join(output,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
let staged;
try{
 const set=JSON.parse(readFileSync(join(dir,'release-set.json')));
 assert.equal(set.commit,'79b3496246346303b32b85cd24304158427e8c0c');
 const context=prepareCandidate(dir,digest(join(dir,'release-set.json')),set.commit,join(base,'diagnostic-candidate'));
 const report={};
 staged=await stageFixtureProject({set,dir,cratesDir:join(context.work,'crates'),targetDir:context.target,profile:'release',report,test:async(name,fn)=>{console.log(name);await fn();}});
 save('setup.json',{set,report,project:staged.project,target:staged.targetDir});
 await withOwnedServer(join(staged.targetDir,'release/fixture-bench'),[],staged.project,async(_,origin)=>{
  const url=origin+'/pages/islands-100';
  for(let i=1;i<=3;i++)save(`unmodified-activation-${i}.json`,await measureActivation(url,'islands-100'));
  const browser=await chromium.launch({headless:true});
  try{
   const s=MOBILE_PROFILE.screenEmulation,t=MOBILE_PROFILE.throttling;
   const context=await browser.newContext({viewport:{width:s.width,height:s.height},deviceScaleFactor:s.deviceScaleFactor,isMobile:true,userAgent:MOBILE_PROFILE.emulatedUserAgent,serviceWorkers:'block'});
   await context.addInitScript(activationInstrumentation,{kind:'islands-100'});
   await context.addInitScript(()=>{globalThis.__formaLoadDiagnostic=[];});
   const original=await (await fetch(origin+'/_assets/islands100.e5ae4fca.js')).text();
   const needle='function mo(e=performance.now()+12){ft=void 0,je++;try{for(let t of He.values()){if(performance.now()>=e)break;t()}}finally{je--,En()}}';
   assert.equal(original.split(needle).length,2,'diagnostic must match exact RC3 drain function once');
   const instrumented='function mo(e=performance.now()+12){let diagnostic={start:performance.now(),work:[]};globalThis.__formaLoadDiagnostic.push(diagnostic);ft=void 0,je++;try{for(let t of He.values()){if(performance.now()>=e)break;let start=performance.now();t();diagnostic.work.push({start,duration:performance.now()-start})}}finally{diagnostic.end=performance.now();je--,En()}}';
   const changed=original.replace(needle,instrumented);
   const sri=body=>'sha384-'+createHash('sha384').update(body).digest('base64');
   await context.route('**/pages/islands-100',async route=>{
    const response=await route.fetch(),html=await response.text();save('original-page.html',html);
    assert(html.includes(sri(original)),'original document must bind original bundle');
    // This diagnostic document binds its changed diagnostic bytes normally;
    // retain CSP and SRI enforcement. It is never an acceptance observation.
    await route.fulfill({response,body:html.replaceAll(sri(original),sri(changed))});
   });
   await context.route('**/_assets/islands100.*.js',async route=>{
    const response=await route.fetch(),body=await response.text();save('original-bundle.js',body);
    assert.equal(body,original);await route.fulfill({response,body:changed});
   });
   const page=await context.newPage(),cdp=await context.newCDPSession(page);
   await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:t.requestLatencyMs,downloadThroughput:t.downloadThroughputKbps*1024/8,uploadThroughput:t.uploadThroughputKbps*1024/8,connectionType:'cellular4g'});
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:t.cpuSlowdownMultiplier});
   await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:250});await cdp.send('Profiler.start');
   await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__formaPerformance?.done);await page.waitForTimeout(100);
   const observation=await page.evaluate(()=>window.__formaPerformance),loads=await page.evaluate(()=>globalThis.__formaLoadDiagnostic);
   save('instrumented-activation.json',observation);save('instrumented-loads.json',loads);
   save('instrumented-profile.json',(await cdp.send('Profiler.stop')).profile);
   assert.equal(observation.active,100,'instrumented workload must actually run');assert(loads.length>0,'instrumented load timing absent');
   save('result.json',{diagnostic:true,releaseQualified:false,thresholdsUnchanged:true,source:set.commit,unmodifiedRuns:3,instrumentedRuns:1});
  }finally{await browser.close();}
 });
}catch(e){save('failure.json',{error:String(e.stack??e),releaseQualified:false});throw e;}
finally{if(staged)rmSync(staged.project,{recursive:true,force:true});}
