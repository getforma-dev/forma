import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_RECORD_MAX_BYTES,readBoundedBody} from './release-record-limits.mjs';
test('DS12 has its own128MiB bound and stream counts exact bytes without trusting headers',async()=>{
 assert.equal(RELEASE_RECORD_MAX_BYTES,128*1024*1024);
 const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4]));c.close();}}));
 assert.deepEqual(await readBoundedBody(response,4),Buffer.from([1,2,3,4]));
 for(const length of [null,'1','5','nonsense']){
  let pulls=0,cancelled=false;
  const body=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(3));},cancel(){cancelled=true;}});
  const r=new Response(body,{headers:length===null?{}:{'content-length':length}});
  await assert.rejects(readBoundedBody(r,4),/byte limit/);
  assert.equal(cancelled,true);assert(pulls<=3,'reader continued pulling after its bound');
 }
});
test('interrupted streams reject and release their reader instead of returning a truncated record',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.error(new Error('transport interrupted'));}});
 await assert.rejects(readBoundedBody(new Response(stream),4),/interrupted/);assert.equal(stream.locked,false);
 await assert.rejects(readBoundedBody(new Response('x'),RELEASE_RECORD_MAX_BYTES+1));
});
