import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedStatus } from './published-scaffold.mjs';

test('unpublished development sources never disable the separate candidate lane or query registry aliases', async()=>{
  const result=await publishedStatus('3.0.0-dev',()=>{throw Error('must not query a development version');});
  assert.equal(result.ready,false);assert.equal(result.version,'3.0.0-dev');assert.equal(result.packages.length,0);
});
test('registry preflight distinguishes a missing version from unreadable status and requires all seven exact identities',async()=>{
  let calls=0;
  const result=await publishedStatus('3.0.0-alpha.1',async()=>{calls++;return{status:404};});
  assert.equal(calls,7);assert.equal(result.missing.length,7);assert.equal(result.ready,false);
  await assert.rejects(()=>publishedStatus('3.0.0',async()=>({status:503,ok:false})),/unreadable/);
  await assert.rejects(()=>publishedStatus('3.0.0',async()=>({status:200,ok:true,json:async()=>({name:'@getforma/core',version:'2.0.0'})})),/2.0.0/);
});
