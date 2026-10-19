// Bounded attribution diagnostic, never release qualification. Product bytes stay unchanged.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {prepareCandidate} from './candidate-scaffold.mjs';
import {stageFixtureProject} from './release-fixture-apps.mjs';
import {withOwnedServer} from './owned-server.mjs';
import {measureActivation,activationInstrumentation,MOBILE_PROFILE} from './release-performance-mobile.mjs';

const base=process.env.RUNNER_TEMP,output=join(base,'diagnostic-219-input'),dir=join(base,'rc4-packed');
mkdirSync(output);
const save=(name,value)=>writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
let staged;
try{
 const set=JSON.parse(readFileSync(join(dir,'release-set.json')));
 assert.equal(set.commit,'329d565575e4d754b8abb115b0c72f1869126348');
 const context=prepareCandidate(dir,'ed67e3301191e0295a5411ed5dd8cd6a12b90bc4c60d8121b97c13ba82b8a999',set.commit,join(base,'diagnostic-candidate'));
 const report={};
 staged=await stageFixtureProject({set,dir,cratesDir:join(context.work,'crates'),targetDir:context.target,profile:'release',report,test:async(name,fn)=>{console.log(name);await fn();}});
 save('setup.json',{set,report});
 await withOwnedServer(join(staged.targetDir,'release/fixture-bench'),[],staged.project,async(_,origin)=>{
  const url=origin+'/pages/islands-100';
  for(let i=1;i<=8;i++){
   const browser=await chromium.launch({headless:true});
   try{
    const s=MOBILE_PROFILE.screenEmulation,t=MOBILE_PROFILE.throttling;
    const context=await browser.newContext({viewport:{width:s.width,height:s.height},deviceScaleFactor:s.deviceScaleFactor,isMobile:true,userAgent:MOBILE_PROFILE.emulatedUserAgent,serviceWorkers:'block'});
    await context.addInitScript(activationInstrumentation,{kind:'islands-100'});
    const page=await context.newPage(),cdp=await context.newCDPSession(page);
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:t.requestLatencyMs,downloadThroughput:t.downloadThroughputKbps*1024/8,uploadThroughput:t.uploadThroughputKbps*1024/8,connectionType:'cellular4g'});
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:t.cpuSlowdownMultiplier});
    const events=[];cdp.on('Tracing.dataCollected',({value})=>events.push(...value));
    await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,loading,blink.user_timing',transferMode:'ReportEvents'});
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__formaPerformance?.done,{},{timeout:12000});await page.waitForTimeout(100);
    const observation=await page.evaluate(()=>window.__formaPerformance);
    save(`original-traced-${i}.json`,{observation,timeOrigin:await page.evaluate(()=>performance.timeOrigin)});
    const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await complete;save(`trace-${i}.json`,{traceEvents:events});
    assert.equal(observation.active,100);assert.equal(observation.responded,100);
   }finally{await browser.close();}
  }
  save('result.json',{diagnostic:true,releaseQualified:false,source:set.commit,originalTracedRuns:8,callbackWrappers:false,cpuProfiler:false,productBytesUnmodified:true,thresholdsUnchanged:true});
 });
}catch(error){save('failure.json',{error:String(error.stack??error),releaseQualified:false});throw error;}
finally{if(staged)rmSync(staged.project,{recursive:true,force:true});}
