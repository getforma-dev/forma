// Fixed N5/M02 protocol. Build perf-build.mjs and the release fixture first.
// This runner owns both loopback servers and all browser processes.
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
process.chdir(repo);
const output = resolve(process.argv[2] ?? resolve(here,'evidence/performance.json'));
if (existsSync(output)) throw Error('Refusing to overwrite an existing performance receipt');
const smoke = process.argv.includes('--smoke');
const selected = process.env.NATIVE_PERF_CELLS?.split(',');
const binary = resolve(here,'server/target/release/forma-router-native-fixture');
const hash = data => createHash('sha256').update(data).digest('hex');
const command = (file, args) => execFileSync(file,args,{encoding:'utf8'}).trim();
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause,ms));
const engines = {chromium,firefox,webkit};
const mobile = {viewport:{width:390,height:844},deviceScaleFactor:1,
  cpuRate:4,network:{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8,connectionType:'cellular3g'}};
const cells = [{engine:'chromium',profile:'desktop'},{engine:'firefox',profile:'desktop'},
  {engine:'webkit',profile:'desktop'},{engine:'chromium',profile:'mobile'}]
  .filter(cell => !selected || selected.includes(`${cell.engine}-${cell.profile}`));
if (!cells.length || (selected && cells.length !== selected.length)) throw Error('Choose unique existing NATIVE_PERF_CELLS, e.g. chromium-desktop');
async function tree(folder) {
  const files = {};
  async function walk(path) {
    for (const entry of await readdir(path,{withFileTypes:true})) {
      if (['node_modules','dist','dist-next','dist-perf','dist-perf-document','target','evidence','.git'].includes(entry.name)) continue;
      const next=resolve(path,entry.name);
      if (entry.isDirectory()) await walk(next); else files[relative(repo,next)]=hash(await readFile(next));
    }
  }
  await walk(folder); return files;
}
async function sources() {
  return Object.assign({},...await Promise.all(['packages/core/src','packages/router/src','packages/compiler/src','packages/build/src','crates/forma-server/src','experiments/forma-router-native'].map(dir=>tree(resolve(repo,dir)))));
}
async function artifacts() {
  const files = {};
  for (const dir of ['dist-perf','dist-perf-document']) for(const name of await readdir(resolve(here,dir))) files[`${dir}/${name}`]=hash(await readFile(resolve(here,dir,name)));
  return files;
}
const started = new Date().toISOString();
const archivePaths = JSON.parse(process.env.NATIVE_PERF_ARCHIVES ?? '[]');
if (!Array.isArray(archivePaths) || archivePaths.some(path => typeof path !== 'string')) throw Error('NATIVE_PERF_ARCHIVES must be a JSON array of actual packed archive paths');
const packageArchives = await Promise.all(archivePaths.map(async path => ({path:resolve(path),sha256:hash(await readFile(path))})));
const result = {startedAt:started,command:process.argv,node:process.version,source:command('git',['rev-parse','HEAD']),
  dirty:command('git',['status','--short']),diffSha256:hash(execFileSync('git',['diff','--binary'])),
  host:{model:command('sysctl',['-n','hw.model']),cpu:command('sysctl',['-n','machdep.cpu.brand_string']),logicalCPUs:Number(command('sysctl',['-n','hw.ncpu'])),memoryBytes:Number(command('sysctl',['-n','hw.memsize'])),os:command('sw_vers',[]),powerBefore:command('pmset',['-g','batt']),rust:command('rustc',['--version'])},
  protocol:{warmupsPerDirection:smoke?1:5,samplesPerDirection:smoke?2:30,pauseMs:250,coldEntriesPerRoute:smoke?1:3,
    desktop:{viewport:{width:1365,height:900},deviceScaleFactor:1,cpuThrottle:'none',network:'unthrottled loopback'},mobile,
    cache:'New context per mode/cell; retained HTTP cache within warm cell. Fresh contexts for cold entries. Private HTML/native responses no-store. No Playwright route interception.',
    statistics:'Nearest rank, each direction separately; no outlier removal. Cold n=3 is descriptive only.',
    frame:'Two requestAnimationFrame callbacks after immediate island readiness; scheduling proxy, not a measured compositor paint.',
    preparation:'Public native session.prepare wrapper completion: validated response/assets/prepared owners ready.',
    history:'Preparation-to-history-start observed interval includes coordinator checks and any history permit wait; history write measured separately.',
    commit:'Conservative synchronous interval from final public validate start (after history permit) through entry to activate. Includes final validation, history write, full PreparedView.commit, signal/title/scroll bookkeeping. ownerCommitMs separately times only PreparedView.commit. islandReadyMs precedes final navigation positioning; readyMs includes complete navigation settlement.',
    documentControl:'Same compiled owner templates/props, public activateIslands only. Every transition is an actual new document with a retained browser cache. Node wall time includes browser driver overhead; browser readiness is separately navigation-start-relative.',
    smoke,scope:'Source integration on this host; no physical device, compositor paint, assistive technology, or packed release claim.'},
  packageArchives,artifacts:await artifacts(),sourceFiles:await sources(),serverBinarySha256:hash(await readFile(binary)),serverBuildProfile:'release',cells:[],failures:[],heap:[]};
const ownedServers = [], ownedBrowsers = new Set();
let interrupted = false;
function interrupt() {interrupted=true;for(const child of ownedServers)child.kill('SIGTERM');for(const browser of ownedBrowsers)void browser.close();}
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
async function save() {await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');}
async function server(folder) {
  const child=spawn(binary,[],{cwd:repo,env:{...process.env,PORT:'0',FORMA_NATIVE_DIST:resolve(here,folder)},stdio:['ignore','pipe','pipe']});
  ownedServers.push(child);let log='';child.stdout.on('data',bytes=>{log+=bytes;});child.stderr.on('data',bytes=>{log+=bytes;});
  const origin=await new Promise((resolveOrigin,reject)=>{
    const timer=setTimeout(()=>reject(Error(`Server ${folder} readiness deadline: ${log}`)),15000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);reject(Error(`Server ${folder} exited ${code??signal}: ${log}`));});
    child.stdout.on('data',()=>{const match=log.match(/^http:\/\/127\.0\.0\.1:\d+$/m);if(match){clearTimeout(timer);resolveOrigin(match[0]);}});
  });
  return {origin,pid:child.pid,folder,child,log:()=>log};
}
async function contextFor(browser,cell) {
  const context=await browser.newContext({viewport:cell.profile==='mobile'?mobile.viewport:{width:1365,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(30000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let cdp;
  if(cell.profile==='mobile'){
    cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',mobile.network);await cdp.send('Emulation.setCPUThrottlingRate',{rate:mobile.cpuRate});
  }
  return {context,page,errors,cdp};
}
async function readiness(page,mode) {
  await page.waitForFunction(mode=>mode==='candidate'?Boolean(window.__bench):Boolean(window.__documentBench),mode);
  return page.evaluate(mode=>(mode==='candidate'?window.__bench:window.__documentBench).ready,mode);
}
async function assertContent(page,path) {
  assert.equal(new URL(page.url()).pathname,path);
  assert.equal(await page.locator('#layout-counter').count(),1);assert.equal(await page.locator(`[id="counter-${path.endsWith('/a')?'a':'b'}"]`).count(),1);
}
function summarize(samples,fields) {
  return Object.fromEntries(['A→B','B→A'].map(direction=>{
    const rows=samples.filter(row=>row.direction===direction);
    return [direction,{n:rows.length,...Object.fromEntries(fields.map(field=>{
      const values=rows.map(row=>row[field]).sort((a,b)=>a-b);
      assert.ok(values.every(Number.isFinite),`Finite ${field} values`);
      return [field,{min:values[0],p50:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)}];
    }))}];
  }));
}
async function warm(browser,cell,mode,origin) {
  const {context,page,errors}=await contextFor(browser,cell);const samples=[],warmups=[];
  try {
    await page.goto(origin+'/native/a');await readiness(page,mode);await assertContent(page,'/native/a');
    let timeOrigin=await page.evaluate(()=>performance.timeOrigin);
    for(let index=0;index<2*(result.protocol.warmupsPerDirection+result.protocol.samplesPerDirection);index++){
      if(interrupted)throw Error('Performance run interrupted');await pause(250);
      const to=index%2===0?'/native/b':'/native/a',direction=index%2===0?'A→B':'B→A';let row;
      if(mode==='candidate'){
        row=await page.evaluate(path=>window.__bench.navigate(path),to);
        assert.equal(await page.evaluate(()=>performance.timeOrigin),timeOrigin,'Enhanced sample preserves document');
      }else{
        const before=performance.now();const response=await page.goto(origin+to);assert.equal(response.status(),200);
        const ready=await readiness(page,mode),nodeReadyMs=performance.now()-before;
        const timing=await page.evaluate(async()=>{
          const frameAt=await window.__documentBench.frame;
          return {timeOrigin:performance.timeOrigin,frameAt,navigation:performance.getEntriesByType('navigation')[0].toJSON()};
        });
        assert.notEqual(timing.timeOrigin,timeOrigin,'Control sample must load a new document');timeOrigin=timing.timeOrigin;
        row={from:index%2===0?'/native/a':'/native/b',to,readyMs:ready.at,frameMs:timing.frameAt,nodeReadyMs,nodeFrameMs:performance.now()-before,navigation:timing.navigation};
      }
      await assertContent(page,to);assert.deepEqual(errors,[],'No browser runtime errors');row={index,direction,...row};
      if(index<2*result.protocol.warmupsPerDirection)warmups.push(row);else samples.push(row);
    }
    const summary=summarize(samples,mode==='candidate'?['prepareMs','preparedToHistoryMs','preparedToCommitMs','historyWriteMs','commitMs','ownerCommitMs','postOwnerBookkeepingMs','islandReadyMs','readyMs','frameMs']:['readyMs','frameMs','nodeReadyMs','nodeFrameMs']);
    const budget=cell.profile==='mobile'?50:16;
    return {mode,warmups,samples,summary,...(mode==='candidate'?{commitBudgetMs:budget,commitPassed:Object.values(summary).every(direction=>direction.commitMs.p95<=budget)}:{})};
  }catch(error){error.partial={mode,warmups,samples};throw error;}finally{await context.close();}
}
async function cold(browser,cell,mode,origin) {
  const samples=[];
  for(const path of ['/native/a','/native/b'])for(let index=0;index<result.protocol.coldEntriesPerRoute;index++){
    const {context,page,errors}=await contextFor(browser,cell);
    try{
      const before=performance.now();const response=await page.goto(origin+path);assert.equal(response.status(),200);
      const ready=await readiness(page,mode),nodeReadyMs=performance.now()-before;
      const timing=await page.evaluate(async mode=>{const frameMs=await (mode==='candidate'?window.__bench:window.__documentBench).frame;return {frameMs,navigation:performance.getEntriesByType('navigation')[0].toJSON()};},mode);
      await assertContent(page,path);assert.deepEqual(errors,[]);samples.push({path,index,readyMs:ready.at,nodeReadyMs,nodeFrameMs:performance.now()-before,...timing});
    }catch(error){error.partial={mode,samples};throw error;}finally{await context.close();}
  }
  return {mode,samples,statistics:'Raw descriptive samples only; no cold-entry p95 with n=3.'};
}
async function heap(browser,origin) {
  const {context,page}=await contextFor(browser,{profile:'desktop'});
  try{
    await page.goto(origin+'/native/a');await readiness(page,'candidate');const cdp=await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    const read=async()=>{await cdp.send('HeapProfiler.collectGarbage');await pause(100);return cdp.send('Runtime.getHeapUsage');};
    for(let index=0;index<10;index++){await pause(250);await page.evaluate(path=>window.__bench.navigate(path),index%2===0?'/native/b':'/native/a');}
    const before=await read();
    for(let index=0;index<(smoke?10:100);index++){await pause(250);await page.evaluate(path=>window.__bench.navigate(path),index%2===0?'/native/b':'/native/a');}
    const after=await read();return {engine:'chromium',profile:'desktop',transitions:smoke?10:100,warmups:10,forcedCollections:2,before,after,
      delta:Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]])),
      scope:'Coarse CDP heap observation after bounded GC, with browser history intentionally growing. No heap threshold and no proof that unexercised workers/observers or all native resources are leak-free.'};
  }finally{await context.close();}
}
let servers;
try{
  assert.match(result.host.powerBefore,/AC Power/,'Fixed protocol requires AC power');
  servers={candidate:await server('dist-perf'),document:await server('dist-perf-document')};
  result.servers=Object.fromEntries(Object.entries(servers).map(([key,value])=>[key,{origin:value.origin,pid:value.pid,folder:value.folder}]));
  await save();
  for(const definition of cells){
    const browser=await engines[definition.engine].launch();ownedBrowsers.add(browser);
    const cell={...definition,browserVersion:browser.version(),startedAt:new Date().toISOString(),warm:[],cold:[],status:'running'};result.cells.push(cell);
    if(definition.engine==='chromium'){
      const cdp=await browser.newBrowserCDPSession();cell.cdpVersion=await cdp.send('Browser.getVersion');await cdp.detach();
    }
    try{
      for(const mode of ['candidate','document']){
        cell.warm.push(await warm(browser,definition,mode,servers[mode].origin));
        cell.cold.push(await cold(browser,definition,mode,servers[mode].origin));await save();
      }
      if(definition.engine==='chromium'&&definition.profile==='desktop')result.heap.push(await heap(browser,servers.candidate.origin));
      cell.status=cell.warm[0].commitPassed?'passed':'failed-budget';
      if(cell.status!=='passed')result.failures.push({cell:`${definition.engine}-${definition.profile}`,error:'Commit p95 exceeded fixed budget'});
      console.log(JSON.stringify({cell:`${definition.engine}-${definition.profile}`,status:cell.status,candidate:cell.warm[0].summary,document:cell.warm[1].summary}));
    }catch(error){cell.status='failed';cell.error=String(error.stack??error);cell.partial=error.partial;result.failures.push({cell:`${definition.engine}-${definition.profile}`,error:cell.error});console.error(cell.error);}
    finally{cell.finishedAt=new Date().toISOString();await browser.close();ownedBrowsers.delete(browser);await save();}
  }
}catch(error){result.failures.push({error:String(error.stack??error)});console.error(error);}
finally{
  for(const browser of ownedBrowsers)await browser.close();
  for(const child of ownedServers)child.kill('SIGTERM');
  await Promise.all(ownedServers.map(child=>new Promise(resolveExit=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolveExit();
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolveExit();},3000);child.once('exit',()=>{clearTimeout(timer);resolveExit();});
  })));
  result.serverLogs=Object.fromEntries(Object.entries(servers??{}).map(([key,value])=>[key,value.log()]));
  result.ownedProcessesStopped=ownedServers.every(child=>child.exitCode!==null||child.signalCode!==null);
  result.finishedAt=new Date().toISOString();result.host.powerAfter=command('pmset',['-g','batt']);
  result.artifactsAfter=await artifacts();result.sourceFilesAfter=await sources();
  result.artifactsChangedDuringRun=JSON.stringify(result.artifacts)!==JSON.stringify(result.artifactsAfter);
  result.sourceChangedDuringRun=JSON.stringify(result.sourceFiles)!==JSON.stringify(result.sourceFilesAfter);
  if(result.artifactsChangedDuringRun||result.sourceChangedDuringRun||!result.ownedProcessesStopped||!/AC Power/.test(result.host.powerAfter))result.failures.push({error:'Artifact/source/power/process integrity check failed'});
  result.status=result.failures.length?'failed':smoke?'smoke-only':'passed';await save();
  console.log(JSON.stringify({status:result.status,output,ownedProcessesStopped:result.ownedProcessesStopped}));
  if(result.failures.length)process.exitCode=1;
}
