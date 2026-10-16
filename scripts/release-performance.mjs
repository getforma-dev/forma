// P17 owns the installed packed fixture project until all measurements finish.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,json,run,digest} from './release-set.mjs';
import {readPerformanceBaseline,PERFORMANCE_CONTRACT,compareReleaseTags} from './release-performance-baseline.mjs';
import {completePerformance,validateNative,validateMobile} from './release-performance-contract.mjs';
import {measureMobileRoute,mobileControls} from './release-performance-mobile.mjs';
import {measurePackedDecoder,validateDecoder} from './release-performance-decoder.mjs';
import {machineProfile} from './release-measurements.mjs';
import {withOwnedServer} from './owned-server.mjs';
import {createPerformanceJournal,writePerformanceRecord,completePerformanceJournal} from './release-performance-journal.mjs';

export function performanceTarget(set,env=process.env){
 assert([undefined,null,PERFORMANCE_CONTRACT].includes(set.contracts.performance),'P17 has no verifier for the recorded performance contract');
 if(!set.contracts.performance)return null;
 assert.equal(set.contracts.fixtureApps,'declared-v1','performance requires packed fixture applications');
 const requested=env.FORMA_PERFORMANCE_TARGET_TAG;
 if(!set.dryRun){compareReleaseTags(set.tag,set.tag);assert(!requested||requested===set.tag,'performance target override differs from actual release tag');return {tag:set.tag,rehearsal:false};}
 assert(/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(requested??''),'dry-run performance requires FORMA_PERFORMANCE_TARGET_TAG naming the intended release');
 compareReleaseTags(requested,requested);
 assert.equal(requested.slice(1).split('-')[0],set.contracts.version,'performance target differs from the candidate base version');
 return {tag:requested,rehearsal:true};
}
// These files outlive disposable packed fixtures and the process itself. Each
// observation is flushed after timing; interruption cannot erase earlier runs.
function durableWrite(file,value,flag){
 const fd=openSync(file,flag);
 try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
}
export async function recordPackedDecoder({corePath,compilerPath,evidenceDirectory,attempt,provenance,measure=measurePackedDecoder}){
 assert(typeof evidenceDirectory==='string'&&evidenceDirectory.length>0,'decoder: durable evidence directory required');
 mkdirSync(evidenceDirectory,{recursive:true});
 const directory=mkdtempSync(join(evidenceDirectory,'decoder-attempt-'));
 const observations=join(directory,'observations.jsonl'),complete=join(directory,'report.json');
 attempt.decoderEvidence={directory,observations,complete};
 durableWrite(join(directory,'attempt.json'),provenance,'wx');
 durableWrite(observations,{kind:'start',provenance},'wx');
 attempt.decoderObservations=[];
 const result=await measure({corePath,compilerPath,onSample:sample=>{
  durableWrite(observations,{kind:'observation',...sample},'a');
  attempt.decoderObservations.push(sample);
 }});
 durableWrite(complete,result,'wx');
 attempt.decoder=result;
 validateDecoder(result);
 delete attempt.decoderObservations;
 return result;
}
export async function verifyPackedPerformance({staged,set,test,target,before,report,evidenceDirectory}){
 const {project,targetDir}=staged;
 const output=createPerformanceJournal(evidenceDirectory,{contract:PERFORMANCE_CONTRACT,commit:set.commit,targetTag:target.tag,rehearsal:target.rehearsal,
  producers:Object.fromEntries(['scripts/release-performance.mjs','scripts/release-performance-mobile.mjs','scripts/release-performance-attribution.mjs','scripts/release-performance-contract.mjs','scripts/release-performance-spec.mjs','scripts/release-performance-journal.mjs','e2e/performance/client/run.mjs','e2e/fixtures/apps/src/bin/measure.rs','e2e/fixtures/apps/src/performance_evidence.rs'].map(file=>[file,digest(join(ROOT,file))]))});
 const record=(kind,value)=>writePerformanceRecord(output,kind,value);
 const nativePath=join(output,'native-report.json'),clientPath=join(output,'client-report.json');
 const attempt=report.performanceAttempt={contract:PERFORMANCE_CONTRACT,targetTag:target.tag,rehearsal:target.rehearsal,mobile:[]};
 attempt.evidenceDirectory=output;
  let baseline;
  await test('performance: the previous published DS12 is authentic, complete and earlier than this run',async()=>{
   baseline=await readPerformanceBaseline({currentTag:target.tag,before});attempt.baseline=baseline;record('baseline',baseline);
  });
  let decoder;
  await test('performance: public packed decoder, forty samples per one-MiB shape at four-times CPU slowdown',async()=>{
   decoder=await recordPackedDecoder({corePath:join(project,'node_modules/@getforma/core'),compilerPath:join(project,'node_modules/@getforma/compiler'),evidenceDirectory,attempt,provenance:{contract:PERFORMANCE_CONTRACT,commit:set.commit,targetTag:target.tag,rehearsal:target.rehearsal}});
  });
  await test('performance: ordinary release binaries use the same exact packed crate lock',async()=>{
   for(const key of Object.keys(process.env))assert(!key.startsWith('CARGO_PROFILE_RELEASE_'),'performance requires the default application release profile');
   assert(!process.env.RUSTFLAGS&&!process.env.CARGO_ENCODED_RUSTFLAGS,'performance requires the default application compiler flags');
   const before=digest(join(project,'Cargo.lock'));
   run('cargo',['build','--release','--locked'],project,{stdio:'inherit',timeout:600000,env:{...process.env,CARGO_TARGET_DIR:targetDir,CARGO_BUILD_JOBS:process.env.CARGO_BUILD_JOBS??'3',CARGO_INCREMENTAL:'0'}});
   assert.equal(digest(join(project,'Cargo.lock')),before,'measurement build changed the packed lock');
  });
  const executable=name=>join(targetDir,'release',name+(process.platform==='win32'?'.exe':''));
  let native;
  await test('performance: N1 twenty thousand walks per consumer shape, N5 and public budget boundaries',async()=>{
   run(executable('fixture-measure'),[join(project,'out/bench/dist'),nativePath],project,{stdio:'inherit',timeout:1200000,env:{...process.env,FORMA_PERFORMANCE_EVIDENCE:output}});native=json(nativePath);attempt.native=native;validateNative(native,baseline);
  });
  const mobile=[];let controls;
  for(const [app,id,path] of [['fauth','tenant-login','/t/acme/login'],['bench','islands-100','/pages/islands-100']]){
   await test(`performance: ${id} twenty cold Lighthouse mobile and real activation runs`,async()=>{
    await withOwnedServer(executable(`fixture-${app}`),[],project,async(_,origin)=>{
     const url=new URL(path,origin).href;const partial={id,runs:[]};attempt.mobile.push(partial);
     mobile.push(await measureMobileRoute({url,id,onPhase:({phase,run,observation})=>record(`mobile-${phase}-${id}-${run}`,observation),onSample:sample=>partial.runs.push(sample),onProgress:line=>process.stderr.write(`${line}\n`)}));
     if(id==='islands-100')controls=await mobileControls(url,({phase,observation})=>record(`mobile-control-${phase}`,observation));
    });
   });
  }
  validateMobile(mobile);
  let client;
  await test('performance: founder client comparison completes in all three engines over packed core',async()=>{
   run(process.execPath,[join(ROOT,'e2e/performance/client/run.mjs'),'--browser','all'],ROOT,{stdio:'inherit',timeout:600000,env:{...process.env,FORMA_BENCH_CORE:join(project,'node_modules/@getforma/core'),FORMA_BENCH_OUTPUT:clientPath,FORMA_PERFORMANCE_EVIDENCE:output}});
   client=json(clientPath);attempt.client=client;
  });
  const machine={...machineProfile({rustc:set.toolchain,npm:set.npm}),profile:'packed npm and crates; ordinary cargo release; N1 prepared typed inputs; Lighthouse13.5.0 applied mobile; serial Chromium/Firefox/WebKit comparison'};
  const result=completePerformance({native,mobile,client,decoder,baseline,machine,controls:controls.controls,controlObservations:controls.observations});
  const measured={...result,rehearsal:target.rehearsal,targetTag:target.tag,controlObservations:controls.observations,toolingLockSha256:digest(join(ROOT,'package-lock.json')),nativeExecutableSha256:digest(executable('fixture-measure'))};
  const evidence=completePerformanceJournal(output,{passed:true,resultSha256:createHash('sha256').update(JSON.stringify(measured)).digest('hex')});
  delete report.performanceAttempt;
  return {...measured,evidence};
}
