import { readCampaign } from '../harness/campaign.mjs';
// One production car per invocation; the portable driver owns its container.
import puppeteer from 'puppeteer-core';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { rows, summary, money } from '../shared/dataset.mjs';
import { validateProfile, verifyRoleAffinity, validateContainerResources } from '../harness/resource-profile.mjs';

const args = {};
for (let i=2; i<process.argv.length; i++) {
  const key=process.argv[i];
  if (!key.startsWith('--')) throw new Error(`unexpected argument ${key}`);
  args[key.slice(2)] = process.argv[i+1]?.startsWith('--') || !process.argv[i+1] ? true : process.argv[++i];
}
const cars=['forma','react-node','react-bun','react-deno','preact-node','solid-node','svelte-node','vue-node','next','react-router','astro'];
if (!cars.includes(args.car) || !args.url || !args.chrome || !args.out) throw new Error('--car, --url, --chrome and --out are required');
const sourceUrl=new URL('/island',args.url).href;
const diagnostic=args.diagnostic===true;
const resourceProfile=args['resource-profile'] ? validateProfile(JSON.parse(readFileSync(args['resource-profile'], 'utf8'))) : null;
const campaign = args.campaign ? readCampaign(args.campaign) : process.env.GP_CAMPAIGN_FILE ? readCampaign() : null;
if (!diagnostic && !campaign) throw new Error('qualified run requires a campaign identity');
if (!diagnostic && !resourceProfile) throw new Error('qualified run requires an explicit resource profile');
if (resourceProfile && resourceProfile.diagnostic !== diagnostic) throw new Error('resource profile diagnostic status differs');
const processAffinity=resourceProfile ? verifyRoleAffinity(resourceProfile, 'browser') : null;
const runs=5, warmups=2;
const digest=createHash('sha256');
for await (const chunk of createReadStream(args.chrome)) digest.update(chunk);
const chromeSha256=digest.digest('hex');
if (!diagnostic && !/^[a-f0-9]{40}$/.test(args.commit??'')) throw new Error('qualified run requires exact --commit');
if (!diagnostic && (!args['chrome-sha256'] || args['chrome-sha256']!==chromeSha256)) throw new Error('qualified run requires the locked --chrome-sha256');
let container=null;
if (!diagnostic) {
  if (!args['container-id']) throw new Error('qualified run requires --container-id');
  const inspected=JSON.parse(execFileSync('docker',['inspect',args['container-id']],{encoding:'utf8'}))[0];
  if (inspected.HostConfig.NanoCpus!==1e9 || inspected.HostConfig.Memory!==1073741824) throw new Error('island server must have exactly one CPU and 1 GiB');
  if (inspected.Config.Labels?.['grandprix'] !== 'forma-264') throw new Error('container is not owned by round 2');
  if (resourceProfile) validateContainerResources(inspected, resourceProfile.classA);
  container={id:inspected.Id,image:inspected.Image,nanoCpus:inspected.HostConfig.NanoCpus,memoryBytes:inspected.HostConfig.Memory};
}
const expectedRows=rows(100).map(r=>[String(r.id),r.label,r.owner,money(r.amount),r.status,r.updated]);
const sums=summary(rows(100));
const expectedSummary=[String(sums.count),String(sums.open),money(sums.total),money(sums.average)];
const output=path.resolve(args.out);
await mkdir(path.dirname(output),{recursive:true});
const result={protocol:'forma-264-island-v1',car:args.car,url:sourceUrl,sourceCommit:args.commit??null,qualifiedProfile:!diagnostic,resourceProfile,campaign,processAffinity,container,runs,warmups,
  measuredAt:new Date().toISOString(),machine:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model,cpus:os.cpus().length,loadBefore:os.loadavg(),node:process.version},
  browser:{executable:args.chrome,sha256:chromeSha256},samples:[],warmupSamples:[],verified:false};
const persist=()=>writeFile(output,JSON.stringify(result,null,2)+'\n');
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
const browser=await puppeteer.launch({executablePath:args.chrome,headless:true,args:['--no-first-run','--disable-extensions','--disable-background-timer-throttling','--disable-renderer-backgrounding'],defaultViewport:{width:1280,height:800}});
function equal(actual,expected,label) { if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual).slice(0,500)}`); }
const readDashboard=()=>({rows:[...document.querySelectorAll('tbody tr')].map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent.trim())),summary:[...document.querySelectorAll('.cards .card b')].map(el=>el.textContent.trim()),count:document.querySelector('#gp-count')?.textContent,button:document.querySelector('#gp-increment')?.textContent});
function checkDashboard(state,label) { equal(state.rows,expectedRows,`${label} rows`);equal(state.summary,expectedSummary,`${label} summary`);equal(state.button,'Increment',`${label} button`); }
try {
  if (resourceProfile) result.browser.processAffinity=verifyRoleAffinity(resourceProfile, 'browser', readFileSync(`/proc/${browser.process().pid}/status`, 'utf8'));
  result.browser.version=await browser.version();
  // Execution disabled: a client-built facsimile cannot pass the server check.
  const ssrContext=await browser.createBrowserContext();
  const ssr=await ssrContext.newPage();
  await ssr.setJavaScriptEnabled(false);
  const response=await ssr.goto(sourceUrl,{waitUntil:'load'});
  if (response.status()!==200) throw new Error(`SSR status ${response.status()}`);
  const initial=await ssr.evaluate(readDashboard);checkDashboard(initial,'server');equal(initial.count,'0','server counter');
  result.serverHtmlBytes=(await response.buffer()).length;
  await ssrContext.close();
  for (let sampleIndex=0; sampleIndex<warmups+runs; sampleIndex++) {
    const context=await browser.createBrowserContext();
    const page=await context.newPage();
    const sample={index:sampleIndex-warmups,errors:[],javascript:[],verified:false};
    (sampleIndex<warmups?result.warmupSamples:result.samples).push(sample);
    try {
      page.on('pageerror',error=>sample.errors.push(String(error)));
      page.on('console',message=>{if(message.type()==='error')sample.errors.push(message.text());});
      const cdp=await page.createCDPSession();await cdp.send('Network.enable');
      const requests=new Map();
      sample.failedJavaScript=[];
      cdp.on('Network.requestWillBeSent',event=>{if(event.type==='Script')requests.set(event.requestId,{url:event.request.url});});
      cdp.on('Network.responseReceived',event=>{if(event.type==='Script')requests.set(event.requestId,{...requests.get(event.requestId),url:event.response.url,status:event.response.status,mimeType:event.response.mimeType,fromDiskCache:event.response.fromDiskCache,fromServiceWorker:event.response.fromServiceWorker});});
      cdp.on('Network.loadingFailed',event=>{if(event.type==='Script'||requests.has(event.requestId)){sample.failedJavaScript.push({...requests.get(event.requestId),error:event.errorText,canceled:event.canceled});requests.delete(event.requestId);}});
      cdp.on('Network.loadingFinished',event=>{const resource=requests.get(event.requestId);if(resource){resource.transferredBytes=event.encodedDataLength;sample.javascript.push(resource);requests.delete(event.requestId);}});
      await page.evaluateOnNewDocument(()=>{
        const original={button:null,count:null};
        // Match individual parser-added nodes, not a descendant query after
        // a framework could have replaced the server subtree.
        const capture=node=>{if(node.nodeType!==1)return;if(node.id==='gp-increment'&&!original.button)original.button=node;if(node.id==='gp-count'&&!original.count)original.count=node;};
        const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)capture(node);});
        observer.observe(document,{childList:true,subtree:true});
        window.__gpOriginal=original;
        window.__gpAssertIdentity=()=>{for(const record of observer.takeRecords())for(const node of record.addedNodes)capture(node);return original.button===document.getElementById('gp-increment')&&original.count===document.getElementById('gp-count')&&original.button!==null&&original.count!==null;};
      });
      const nav=await page.goto(sourceUrl,{waitUntil:'load'});
      if(nav.status()!==200)throw new Error(`navigation status ${nav.status()}`);
      sample.htmlBytes=(await nav.buffer()).length;
      await page.waitForFunction(()=>window.__gpIsland?.ready===true,{timeout:15000});
      const ready=await page.evaluate(()=>({...window.__gpIsland,identity:window.__gpAssertIdentity()}));
      if(!ready.identity)throw new Error('native activation replaced or failed to capture server counter nodes');
      if(!Number.isFinite(ready.readyAt)||ready.readyAt<0)throw new Error('invalid readiness measurement');
      const unavailable=ready.activationMs===null&&ready.activationStart===null;
      if(unavailable){if(!['next','astro'].includes(args.car))throw new Error('native activation boundary unexpectedly unavailable');}
      else if(!Number.isFinite(ready.activationStart)||ready.activationStart<0||!Number.isFinite(ready.activationMs)||ready.activationMs<0||Math.abs((ready.readyAt-ready.activationStart)-ready.activationMs)>0.1)throw new Error('invalid native activation boundary');
      sample.readinessMs=ready.readyAt;sample.activationMs=ready.activationMs;
      const activated=await page.evaluate(readDashboard);checkDashboard(activated,'activated');equal(activated.count,'0','initial activated counter');
      sample.clickMs=[];
      for (const expected of ['1','2']) {
        const elapsed=await page.evaluate(expected=>new Promise((resolve,reject)=>{
          const count=document.getElementById('gp-count'),button=document.getElementById('gp-increment');
          const started=performance.now();let done=false;
          const observer=new MutationObserver(check);
          const timer=setTimeout(()=>{observer.disconnect();reject(new Error('counter update timeout'));},5000);
          function check(){if(!done&&count.textContent===expected){done=true;observer.disconnect();clearTimeout(timer);resolve(performance.now()-started);}}
          observer.observe(count,{subtree:true,childList:true,characterData:true});button.click();check();
        }),expected);
        sample.clickMs.push(elapsed);
        const after=await page.evaluate(readDashboard);checkDashboard(after,`click ${expected}`);equal(after.count,expected,'counter update');
        if(!await page.evaluate(()=>window.__gpAssertIdentity()))throw new Error('counter nodes replaced during update');
      }
      await page.waitForNetworkIdle({idleTime:500,timeout:15000});
      if(requests.size)throw new Error('unfinished JavaScript transfers');
      if(sample.failedJavaScript.length)throw new Error('failed JavaScript transfers');
      if(sample.javascript.some(resource=>resource.status!==200||resource.fromDiskCache||resource.fromServiceWorker||!Number.isFinite(resource.transferredBytes)||resource.transferredBytes<=0))throw new Error('failed, cached or unmeasured JavaScript response');
      sample.transferredJavaScriptBytes=sample.javascript.reduce((sum,resource)=>sum+resource.transferredBytes,0);
      if(!sample.javascript.length)throw new Error('no framework JavaScript transferred');
      if(sample.errors.length)throw new Error(`browser errors: ${sample.errors.join('; ')}`);
      sample.verified=true;
    } catch(error) {sample.failure=String(error);throw error;} finally {await context.close();await persist();}
  }
  const stats=values=>{const sorted=values.slice().sort((a,b)=>a-b);return{median:sorted.length%2?sorted[Math.floor(sorted.length/2)]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2,min:sorted[0],max:sorted.at(-1)};};
  result.summary={htmlBytes:stats(result.samples.map(s=>s.htmlBytes)),transferredJavaScriptBytes:stats(result.samples.map(s=>s.transferredJavaScriptBytes)),readinessMs:stats(result.samples.map(s=>s.readinessMs)),activationMs:result.samples.every(s=>s.activationMs!==null)?stats(result.samples.map(s=>s.activationMs)):null,clickMs:stats(result.samples.flatMap(s=>s.clickMs))};
  result.transferredJavaScriptDefinition='CDP Network.loadingFinished encodedDataLength for Script resources, including HTTP response overhead; fresh contexts, through readiness and two clicks plus 500 ms network idle.';
  result.verified=true;
} catch(error) {result.failure=String(error);process.exitCode=1;} finally {result.machine.loadAfter=os.loadavg();await persist();await browser.close();}
console.log(JSON.stringify({car:result.car,verified:result.verified,qualifiedProfile:result.qualifiedProfile,summary:result.summary,failure:result.failure,output}));
