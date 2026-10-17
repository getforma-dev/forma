import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateBaselineRecord,readPerformanceBaseline,compareReleaseTags,N1_SHAPES} from './release-performance-baseline.mjs';
const sha='a'.repeat(64),commit='b'.repeat(40);
const context={tag:'v3.0.0-alpha.2',currentTag:'v3.0.0-beta.1',publishedAt:'2026-10-15T00:00:00Z',before:'2026-10-16T00:00:00Z',digest:sha};
function record(){return {schema:1,dryRun:false,tag:context.tag,commit,contracts:{},packages:[...['forma-ir','forma-ir-derive','forma-server'].map(name=>({registry:'crates',name})),...['core','compiler','build','create-app'].map(name=>({registry:'npm',name:`@getforma/${name}`}))].map(p=>({...p,version:context.tag.slice(1),sha256:sha})),measurements:{commit,passed:true}};}
test('only authenticated alpha history establishes the first published beta baseline',()=>{
 for(const currentTag of ['v3.0.0-beta.1','v3.0.0-beta.2','v3.0.0-beta.10'])assert.equal(validateBaselineRecord(record(),{...context,currentTag}).status,'bootstrap');
 for(const currentTag of ['v3.0.0-rc.1','v3.0.0','v3.0.1-beta.1'])assert.throws(()=>validateBaselineRecord(record(),{...context,currentTag}),/only first published beta/);
 const prior=record();prior.tag='v3.0.0-beta.1';for(const p of prior.packages)p.version='3.0.0-beta.1';
 assert.throws(()=>validateBaselineRecord(prior,{...context,tag:prior.tag,currentTag:'v3.0.0-beta.2'}),/only first published beta/);
});
test('prior chronology, exact set and successful P17 are mandatory',()=>{
 for(const edit of [r=>r.packages.pop(),r=>r.packages[1]=r.packages[0],r=>r.packages[0].version='3.0.0',r=>r.packages[0].sha256='',r=>r.measurements.passed=false,r=>r.measurements.commit='c'.repeat(40),r=>r.dryRun=true,r=>r.tag='v3.0.0-alpha.1',r=>r.schema=2]){const r=record();edit(r);assert.throws(()=>validateBaselineRecord(r,context));}
 assert.throws(()=>validateBaselineRecord(record(),{...context,before:context.publishedAt}),/earlier/);
 assert.throws(()=>validateBaselineRecord(record(),{...context,currentTag:context.tag}),/prior/);
});
test('claimed unknown or incomplete performance never becomes bootstrap',()=>{
 for(const contract of ['measured-v2','',false,0,{}]){const r=record();r.contracts.performance=contract;assert.throws(()=>validateBaselineRecord(r,context),/unsupported/);}
 const r=record();r.contracts.performance='measured-v1';assert.throws(()=>validateBaselineRecord(r,context),/record missing/);
 r.measurements.measurements={performance:{contract:'measured-v1',passed:true,machine:{profile:'packed',cpuModel:'test',node:'v24.22.0'},nativeProfile:'cargo build --release --locked',controls:{deadActivationRefused:true,longTaskRefused:true},n5:{points:[100,200,400,800,1600,3200].map(rows=>({rows})),medianTimeRatio:32},boundaries:{onePastIteration:{code:'RENDER-302'},onePastOutput:{code:'RENDER-301'}},mobile:['tenant-login','islands-100'].map(id=>({id,p95TbtMs:0,runs:Array.from({length:20},()=>({lighthouse:{rawLhr:'{}'},activation:{responded:id==='islands-100'?100:2}}))})),client:{browsers:{chromium:{},firefox:{},webkit:{}}},n1:N1_SHAPES.map(nominalNodes=>({nominalNodes,walks:20000,p99NodesPerSecond:1500000}))}};
 assert.throws(()=>validateBaselineRecord(r,context),'incomplete measurements must not be comparable');
 r.measurements.measurements.performance.n1.pop();assert.throws(()=>validateBaselineRecord(r,context));
});
test('release ordering uses numeric versions and prerelease counters',()=>{
 const order=['v3.0.0-alpha.2','v3.0.0-alpha.10','v3.0.0-beta.1','v3.0.0-rc.1','v3.0.0','v3.0.1'];
 for(let i=1;i<order.length;i++)assert(compareReleaseTags(order[i-1],order[i])<0);
});
test('reader verifies GitHub metadata digest and refuses transport or asset faults',async()=>{
 const bytes=Buffer.from(JSON.stringify(record())),digest=createHash('sha256').update(bytes).digest('hex');
 const asset={name:'release-record.json',url:'https://api.github.com/repos/getforma-dev/forma/releases/assets/123',size:bytes.length,digest:`sha256:${digest}`};
 const release={id:1,tag_name:context.tag,published_at:context.publishedAt,draft:false,prerelease:true,assets:[asset]};
 const fetchImpl=async(url)=>url.includes('/assets/')?new Response(bytes):Response.json([release]);
 const args={currentTag:context.currentTag,before:context.before,fetchImpl};
 assert.equal((await readPerformanceBaseline(args)).sha256,digest);
 await assert.rejects(readPerformanceBaseline({...args,fetchImpl:async()=>new Response('unavailable',{status:503})}),/request failed/);
 asset.digest=`sha256:${sha}`;await assert.rejects(readPerformanceBaseline(args),/digest differs/);
 asset.digest=`sha256:${digest}`;asset.url='https://example.org/asset';await assert.rejects(readPerformanceBaseline(args),/untrusted/);
});
test('a failed beta tag without a Release can recover; a published beta cannot disappear behind alpha',async()=>{
 const bytes=Buffer.from(JSON.stringify(record())),digest=createHash('sha256').update(bytes).digest('hex');
 const asset={name:'release-record.json',url:'https://api.github.com/repos/getforma-dev/forma/releases/assets/123',size:bytes.length,digest:`sha256:${digest}`};
 const alpha={id:1,tag_name:context.tag,published_at:context.publishedAt,draft:false,prerelease:true,assets:[asset]};
 const args={currentTag:'v3.0.0-beta.2',before:context.before};
 // Failed tags do not create published DS12s. No transport error or missing
 // record on a published release is used to infer that absence.
 assert.equal((await readPerformanceBaseline({...args,fetchImpl:async url=>url.includes('/assets/')?new Response(bytes):Response.json([alpha])})).status,'bootstrap');
 const beta={...alpha,id:2,tag_name:'v3.0.0-beta.1',assets:[]};
 await assert.rejects(readPerformanceBaseline({...args,fetchImpl:async()=>Response.json([alpha,beta])}),/no unique record asset/);
 const prior=record();prior.tag=beta.tag_name;for(const p of prior.packages)p.version='3.0.0-beta.1';
 const priorBytes=Buffer.from(JSON.stringify(prior));
 beta.assets=[{...asset,size:priorBytes.length,digest:`sha256:${createHash('sha256').update(priorBytes).digest('hex')}`}];
 await assert.rejects(readPerformanceBaseline({...args,fetchImpl:async url=>url.includes('/assets/')?new Response(priorBytes):Response.json([alpha,beta])}),/only first published beta/);
 await assert.rejects(readPerformanceBaseline({...args,fetchImpl:async()=>new Response('unavailable',{status:503})}),/request failed/);
});
test('malformed newer unified inventory cannot fall back to an older bootstrap record',async()=>{
 const bytes=Buffer.from(JSON.stringify(record())),digest=createHash('sha256').update(bytes).digest('hex');
 const asset={name:'release-record.json',url:'https://api.github.com/repos/getforma-dev/forma/releases/assets/123',size:bytes.length,digest:`sha256:${digest}`};
 const older={id:1,tag_name:context.tag,published_at:context.publishedAt,draft:false,prerelease:true,assets:[asset]};
 for(const edit of [r=>r.draft='false',r=>r.prerelease='true',r=>r.prerelease=false,r=>r.published_at='2026-02-30T00:00:00Z',r=>r.published_at='2026-10-15',r=>r.tag_name='v3.0.0-alpha.03']){
  const newer={...older,id:2,tag_name:'v3.0.0-alpha.3'};edit(newer);
  const fetchImpl=async url=>url.includes('/assets/')?new Response(bytes):Response.json([newer,older]);
  await assert.rejects(readPerformanceBaseline({currentTag:context.currentTag,before:context.before,fetchImpl}));
 }
 for(const duplicate of [{...older},{...older,id:2},{...older,tag_name:'v3.0.0-alpha.3'}]){
  const fetchImpl=async url=>url.includes('/assets/')?new Response(bytes):Response.json([older,duplicate]);
  await assert.rejects(readPerformanceBaseline({currentTag:context.currentTag,before:context.before,fetchImpl}));
 }
});
