// Test evidence only: deterministic complete samples, never release measurements.
import {createHash} from 'node:crypto';
import {DECODER_CSP,DECODER_PROFILE,DECODER_FIXTURES,decoderPayload} from './release-performance-decoder.mjs';
import {MOBILE_PROFILE} from './release-performance-mobile.mjs';
const hash='a'.repeat(64);
export function native(){return {schema:1,pilot:false,profile:'cargo build --release --locked',n1:[300,1500,10000,15000,20000].map(n=>{const time=n===300?200000:n*500;return {nominalNodes:n,nodes:n,walks:20000,samplesNanoseconds:Array(20000).fill(time),p50Nanoseconds:time,p99Nanoseconds:time,p50NodesPerSecond:n*1e9/time,p99NodesPerSecond:n*1e9/time,moduleSha256:hash,inputSha256:hash,outputSha256:hash}}),n5:{points:[100,200,400,800,1600,3200].map(rows=>({rows,allocations:rows*12,allocatedBytes:rows*400,samplesNanoseconds:Array(41).fill(rows*500),medianNanoseconds:rows*500,moduleSha256:hash,inputSha256:hash})),pairedRounds:41,pairedTimeRatios:Array(41).fill(32),medianTimeRatio:32},boundaries:{exactPass:true,partialHtmlReturned:false,exactIterations:400,exactBytes:50000,onePastIteration:{code:'RENDER-302',limit:399},onePastOutput:{code:'RENDER-301',limit:49999}}};}

export function comparison(){
 const sample={script_ms:1,settled_ms:2,mutations:{attributes:0,character_data:1,added_nodes:0,removed_nodes:0},dom_nodes:10};
 const summary=n=>({median:n,p95:n,min:n,max:n,spread_percent:0});
 const metric=(server=false,repetitions=1)=>({script_ms:summary(1),settled_ms:summary(2),mutations:Object.fromEntries(Object.entries(sample.mutations).map(([k,v])=>[k,summary(v)])),dom_nodes:summary(10),samples:Array.from({length:12},()=>({...structuredClone(sample),...(repetitions>1?{repetitions}:{}),...(server?{browser_requests:1,provider_executions:1}:{})})),...(server?{browser_requests:summary(1),provider_executions:summary(1)}:{})});
 const runtime=()=>Object.fromEntries(['mount_1','mount_50','mount_100','mount_500','update_one_of_500','update_all_500','reverse_1000'].map(k=>[k,metric(false,k.startsWith('update_one')?5000:k.startsWith('update_all')?20:k.startsWith('reverse')?10:1)]));
 return {schema_version:2,recorded_at:'2026-10-16T00:00:00Z',methodology:{browsers:['chromium','firefox','webkit'],react_compiler_verified:true,production_builds:true,cross_origin_isolated:true,runs:12,warmups:3,mount_counts:[1,50,100,500],update_count:500,list_count:1000,server_state_count:50},environment:{node:'v24.22.0',platform:'darwin',release:'25',architecture:'arm64',cpu:'test CPU',logical_cpus:8,memory_bytes:1000000,git_commit:'b'.repeat(40),git_branch:'test',git_dirty:false},versions:{forma:'3.0.0-beta.1',react:'19.2.8',react_dom:'19.2.8',tanstack_query:'5.101.4',react_compiler:'1.0.0'},bundles:Object.fromEntries(['forma.js','forma-query.js','react.js','react-query.js'].map(k=>[k,{raw_bytes:1000,gzip_bytes:500,brotli_bytes:450}])),browsers:Object.fromEntries(['chromium','firefox','webkit'].map(engine=>[engine,{version:'123',runtime:Object.fromEntries(['forma','react_compiler'].map(f=>[f,{...runtime(),...(engine==='chromium'?{memory_500:{baseline_used_bytes:100,mounted_used_bytes:110,retained_delta_bytes:10,dom_nodes:10}}:{})}])),server_state:Object.fromEntries(['forma_isolated','forma_shared','react_query'].map(k=>[k,metric(true)]))}]))};
}
export function mobile(){
 return ['tenant-login','islands-100'].map(id=>({id,pilot:false,profile:MOBILE_PROFILE,p95TbtMs:0,runs:Array.from({length:20},(_,i)=>{
  const lhr={lighthouseVersion:'13.5.0',configSettings:MOBILE_PROFILE,environment:{benchmarkIndex:123},audits:{'total-blocking-time':{numericValue:0},'largest-contentful-paint':{numericValue:123},'long-tasks':{details:{type:'table',items:[]}}}},rawLhr=JSON.stringify(lhr),count=id==='islands-100'?100:2;
  return {run:i+1,lighthouse:{version:'13.5.0',throttlingMethod:'devtools',benchmarkIndex:123,tbtMs:0,lcpMs:123,longTasks:[],rawLhr,sha256:createHash('sha256').update(rawLhr).digest('hex')},activation:{expected:count,active:count,responded:count,firstPaintMs:100,lastResponseMs:200,longTasks:[],errors:[]}};
 })}));
}
export function performanceRecord(){const n=native();return {contract:'measured-v1',passed:true,machine:{profile:'packed',cpuModel:'test',node:'v24.22.0'},nativeProfile:n.profile,controls:{deadActivationRefused:true,longTaskRefused:true},controlObservations:controlObservations(),n1:n.n1,n5:n.n5,boundaries:n.boundaries,mobile:mobile(),client:comparison(),decoder:decoder()};}

const sha=value=>createHash('sha256').update(value).digest('hex');
// Synthetic finite validator inputs only. These figures are never used as
// release measurements; the producer supplies actual browser observations.
export function decoder() {
  const cases=DECODER_FIXTURES.map(fixture=>{
    const payload=decoderPayload(fixture);
    const observation=run=>({run,elapsedMs:12,calls:1,valueSha256:payload.valueSha256,valueLength:payload.value.length,
      mutations:0,hostStatus:'pending',stateBlocks:1,pageErrors:[],consoleErrors:[],browserConsoleErrors:[],policyViolations:[]});
    return {id:fixture.id,registration:{h:fixture.h,mode:0,schema:fixture.schema},sourceSha256:fixture.sourceSha256,irSha256:fixture.irSha256,
      payloadBytes:payload.bytes,payloadSha256:payload.sha256,warmups:Array.from({length:5},(_,i)=>observation(i+1)),
      samples:Array.from({length:40},(_,i)=>observation(i+1)),summary:{minMs:12,medianMs:12,p95Ms:12,maxMs:12}};
  });
  const first=decoderPayload(DECODER_FIXTURES[0]);
  const controls=['oversize-one-byte','malformed-json'].map((id,i)=>{
    const text=i===0?first.text+' ':first.text.slice(0,-1);
    const errors=[`[forma] FORMA_E_ISLAND_STATE: ${i===0?'state block exceeds one MiB':'invalid state JSON'}`];
    return {id,payloadBytes:Buffer.byteLength(text),payloadSha256:sha(text),observation:{elapsedMs:null,calls:0,valueSha256:null,
      valueLength:null,mutations:0,hostStatus:'pending',stateBlocks:1,pageErrors:[],consoleErrors:errors,browserConsoleErrors:errors,policyViolations:[]}};
  });
  return {schema:1,pilot:false,profile:{...DECODER_PROFILE},responsePolicy:DECODER_CSP,browserVersion:'test-only',recordedAt:'2026-10-15T00:00:00.000Z',
    artifact:{file:'dist/forma.esm.js',sha256:'a'.repeat(64),bytes:100},
    compiler:{file:'dist/index.js',sha256:'a'.repeat(64),fixtures:DECODER_FIXTURES.map(f=>({id:f.id,sourceSha256:f.sourceSha256,irSha256:f.irSha256,registration:{h:f.h,mode:0,schema:f.schema}}))},
    machine:{node:'test',platform:'test',release:'test',architecture:'test',cpu:'test',logicalCpus:1,memoryBytes:1},cases,controls};
}

export function controlObservations(){
 const common={expected:100,hosts:100,hostStatuses:Array(100).fill('pending'),firstPaintMs:100,longTasks:[],errors:[],done:true};
 return {dead:{...structuredClone(common),active:0,responded:0,lastResponseMs:null},slow:{...structuredClone(common),active:100,responded:100,lastResponseMs:300,longTasks:[{startTime:150,duration:91}],injectedTask:{startTime:150.2,endTime:240.2}}};
}
