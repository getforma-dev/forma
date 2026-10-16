// Actual Lighthouse mobile audits and independent event-response observations.
// All browser/network throttling is local to the owned browser, never the machine.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MOBILE_PROFILE} from './release-performance-spec.mjs';
export {MOBILE_PROFILE} from './release-performance-spec.mjs';
import {percentile,validateMobileControls} from './release-performance-contract.mjs';


// Serialized into each fresh page before any application script executes.
export function activationInstrumentation({kind,longTask}) {
 const expected=kind==='islands-100'?100:2;
 const result=window.__formaPerformance={expected,active:0,responded:0,firstPaintMs:null,lastResponseMs:null,longTasks:[],errors:[],done:false};
 const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())result.longTasks.push({startTime:entry.startTime,duration:entry.duration});});observer.observe({type:'longtask',buffered:true});
 addEventListener('error',event=>result.errors.push(String(event.message)));
 addEventListener('unhandledrejection',event=>result.errors.push(String(event.reason)));
 addEventListener('forma:error',event=>result.errors.push(String(event.detail?.code??event.detail)));
 const completed=new Set();
 function tick(){
  const hosts=[...document.querySelectorAll('[data-forma-island]')];result.hostStatuses=hosts.map(h=>h.getAttribute('data-forma-status'));
  result.hosts=hosts.length;
  result.firstPaintMs=performance.getEntriesByName('first-paint')[0]?.startTime??null;
  if(hosts.length===expected){
   if(kind==='islands-100'){
    // Ten real events per animation frame avoid adding one artificial100-click
    // long task. Each retained node must synchronously reflect its own update.
    for(const host of hosts.filter(h=>!completed.has(h)).slice(0,10)){
     const button=host.querySelector('.tile-more'),output=host.querySelector('.tile-count');
     if(!button||!output)continue;const before=Number(output.textContent);button.click();
     if(Number(output.textContent)===before+1){completed.add(host);result.lastResponseMs=performance.now();}
    }
   }else{
    if(!completed.has('oauth')){document.querySelector('#oauth-google')?.click();if(document.querySelector('#oauth-chosen')?.textContent==='Continuing with Google'){completed.add('oauth');result.lastResponseMs=performance.now();}}
    if(!completed.has('auth')){document.querySelector('#lc-toggle')?.click();if(document.querySelector('#auth-subtitle')?.textContent==='Create your account'){completed.add('auth');result.lastResponseMs=performance.now();}}
   }
   result.responded=completed.size;result.active=completed.size;
   if(result.responded===expected&&result.firstPaintMs!==null){result.done=true;return;}
  }
  if(!result.done)requestAnimationFrame(tick);
 }
 if(longTask)addEventListener('DOMContentLoaded',()=>{const startTime=performance.now(),until=startTime+90;while(performance.now()<until){}result.injectedTask={startTime,endTime:performance.now()};},{once:true});
 setTimeout(()=>{result.done=true;},8000);requestAnimationFrame(tick);
}
export async function measureActivation(url,kind,{disabled=false,longTask=false}={}){
 const {chromium}=await import('@playwright/test');
 const browser=await chromium.launch({headless:true});
 try{
  const screen=MOBILE_PROFILE.screenEmulation;
  const context=await browser.newContext({viewport:{width:screen.width,height:screen.height},deviceScaleFactor:screen.deviceScaleFactor,isMobile:true,userAgent:MOBILE_PROFILE.emulatedUserAgent,serviceWorkers:'block'});
  if(disabled)await context.route('**/*',route=>route.request().resourceType()==='script'?route.abort():route.continue());
  await context.addInitScript(activationInstrumentation,{kind,longTask});
  const page=await context.newPage(),cdp=await context.newCDPSession(page),throttle=MOBILE_PROFILE.throttling;
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:throttle.requestLatencyMs,downloadThroughput:throttle.downloadThroughputKbps*1024/8,uploadThroughput:throttle.uploadThroughputKbps*1024/8,connectionType:'cellular4g'});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle.cpuSlowdownMultiplier});
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__formaPerformance?.done,{},{timeout:12000});
  // Let the buffered long-task observer deliver the task that completed the probe.
  await page.waitForTimeout(100);
  return await page.evaluate(()=>window.__formaPerformance);
 }finally{await browser.close();}
}
export async function audit(url,{saveArtifacts}={}){
 const [{default:lighthouse},chromeLauncher,{chromium},{defaultSettings}]=await Promise.all([import('lighthouse'),import('chrome-launcher'),import('@playwright/test'),import('lighthouse/core/config/constants.js')]);
 assert.deepEqual({...MOBILE_PROFILE,throttling:{...defaultSettings.throttling},screenEmulation:{...defaultSettings.screenEmulation},emulatedUserAgent:defaultSettings.emulatedUserAgent},MOBILE_PROFILE,'installed Lighthouse preset differs from the pinned measurement contract');
 const chrome=await chromeLauncher.launch({chromePath:chromium.executablePath(),chromeFlags:['--headless','--no-sandbox'],logLevel:'error'});
 try{
  const result=await lighthouse(url,{port:chrome.port,logLevel:'error',output:'json',onlyCategories:['performance'],...MOBILE_PROFILE});
  if(saveArtifacts)await saveArtifacts(result?.artifacts);
  const lhr=result?.lhr;assert(lhr&&!lhr.runtimeError,`Lighthouse did not complete: ${JSON.stringify(lhr?.runtimeError)}`);
  assert.equal(lhr.lighthouseVersion,'13.5.0');assert.equal(lhr.configSettings.throttlingMethod,'devtools');
  assert.deepEqual(lhr.configSettings.throttling,MOBILE_PROFILE.throttling,'Lighthouse applied another mobile profile');
  const rawLhr=JSON.stringify(lhr);
  const tasks=lhr.audits['long-tasks'];assert(tasks?.details?.type==='table','Lighthouse long-task audit absent');
  return {version:lhr.lighthouseVersion,throttlingMethod:lhr.configSettings.throttlingMethod,benchmarkIndex:lhr.environment.benchmarkIndex,tbtMs:lhr.audits['total-blocking-time'].numericValue,lcpMs:lhr.audits['largest-contentful-paint'].numericValue,longTasks:tasks.details.items.map(row=>({duration:row.duration,startTime:row.startTime})),sha256:createHash('sha256').update(rawLhr).digest('hex'),rawLhr};
 }finally{await chrome.kill();}
}
export async function measureMobileRoute({url,id,runs=20,onProgress=()=>{},onSample=()=>{},onPhase=()=>{}}){
 assert(runs===20||runs===1,'only full measurement or explicit one-run pilot');
 const results=[];
 for(let run=0;run<runs;run++){
  const lighthouse=await audit(url);
  await onPhase({id,run:run+1,phase:'lighthouse',observation:lighthouse});
  const activation=await measureActivation(url,id);
  await onPhase({id,run:run+1,phase:'activation',observation:activation});
  results.push({run:run+1,lighthouse,activation});onSample(results.at(-1));onProgress(`${id}: ${run+1}/${runs} cold Lighthouse and activation runs`);
 }
 return {id,pilot:runs!==20,profile:MOBILE_PROFILE,runs:results,p95TbtMs:percentile(results.map(r=>r.lighthouse.tbtMs),.95)};
}
export async function mobileControls(url,onPhase=()=>{}){
 const dead=await measureActivation(url,'islands-100',{disabled:true});
 await onPhase({phase:'dead',observation:dead});
 const slow=await measureActivation(url,'islands-100',{longTask:true});
 await onPhase({phase:'slow',observation:slow});
 const observations={dead,slow};
 return {controls:validateMobileControls(observations),observations};
}
