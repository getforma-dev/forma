import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readPerformanceBaseline} from './release-performance-baseline.mjs';
import {readSupportHistory} from './release-support-history.mjs';
import {RELEASE_RECORD_MAX_BYTES} from './release-record-limits.mjs';
const API='https://api.github.com/repos/getforma-dev/forma';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const tag='v3.0.0-alpha.2',commit='a'.repeat(40);
 const packages=[...['forma-ir','forma-ir-derive','forma-server'].map(name=>({registry:'crates',name})),...['core','compiler','build','create-app'].map(name=>({registry:'npm',name:`@getforma/${name}`}))].map(p=>({...p,version:tag.slice(1),sha256:'b'.repeat(64)}));
 const record={schema:1,dryRun:false,tag,commit,packages,contracts:{},measurements:{commit,passed:true}};
 return {record,metadata:{id:1,tag_name:tag,draft:false,prerelease:true,published_at:'2026-10-15T00:00:00Z',assets:[{name:'release-record.json',url:`${API}/releases/assets/123`}]}};
}
test('both published readers accept authenticated evidence larger than the old32MiB limit',async()=>{
 const {record,metadata}=fixture();record.evidencePadding='x'.repeat(33*1024*1024);
 const bytes=Buffer.from(JSON.stringify(record));Object.assign(metadata.assets[0],{size:bytes.length,digest:`sha256:${sha(bytes)}`});
 const fetchImpl=async url=>url.includes('/assets/')?new Response(new ReadableStream({start(c){for(let at=0;at<bytes.length;at+=65536)c.enqueue(bytes.subarray(at,at+65536));c.close();}})):Response.json([metadata]);
 assert.equal((await readPerformanceBaseline({currentTag:'v3.0.0-beta.1',before:'2026-10-16T00:00:00Z',fetchImpl})).status,'bootstrap');
 assert.equal((await readSupportHistory({targetTag:'v3.0.0-beta.1',fetchImpl})).sources[0].sha256,sha(bytes));
});
test('both readers reject oversized asset metadata before downloading and authenticate before parsing',async()=>{
 const {metadata}=fixture();let requested=0;
 Object.assign(metadata.assets[0],{size:RELEASE_RECORD_MAX_BYTES+1,digest:`sha256:${'0'.repeat(64)}`});
 const fetchImpl=async url=>{if(url.includes('/assets/')){requested++;return new Response('not JSON');}return Response.json([metadata]);};
 const readers=[()=>readPerformanceBaseline({currentTag:'v3.0.0-beta.1',before:'2026-10-16T00:00:00Z',fetchImpl}),()=>readSupportHistory({targetTag:'v3.0.0-beta.1',fetchImpl})];
 for(const read of readers)await assert.rejects(read(),/size/);
 assert.equal(requested,0);
 metadata.assets[0].size=8;
 for(const read of readers)await assert.rejects(read(),/digest differs|checksum mismatch/);
 assert.equal(requested,2);
});
