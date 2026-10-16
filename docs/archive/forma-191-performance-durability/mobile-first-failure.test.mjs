import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

// Evaluate the actual producer body with deterministic browser dependencies.
// This control also runs against the archived, unmodified pre-fix source.
const source=readFileSync(new URL('./release-performance-mobile.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export async function measureMobileRoute'),source.indexOf('export async function mobileControls')).replace('export ','');
test('a complete Lighthouse result is delivered before a failing activation loses the pair',async()=>{
 const lighthouse={rawLhr:'{"actual":"completed fixture"}',sha256:'fixture-hash'},seen=[];
 const route=new Function('assert','audit','measureActivation','percentile',`return (${body.trim()});`)(assert,async()=>lighthouse,async()=>{throw new Error('activation failed');},()=>0);
 await assert.rejects(route({url:'http://fixture.invalid/',id:'islands-100',runs:1,onPhase:event=>seen.push(event)}),/activation failed/);
 assert.deepEqual(seen,[{id:'islands-100',run:1,phase:'lighthouse',observation:lighthouse}]);
});
