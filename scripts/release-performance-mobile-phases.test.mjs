import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

// Evaluate the actual producer body with deterministic browser dependencies.
// This control also runs against the archived, unmodified pre-fix source.
const source=readFileSync(new URL('./release-performance-mobile.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export async function measureMobileRoute'),source.indexOf('export async function mobileControls')).replace('export ','');
test('a complete Lighthouse result is delivered before a failing activation loses the pair',async()=>{
 const lighthouse={rawLhr:'{"actual":"completed fixture"}',sha256:'fixture-hash'},rawTrace={traceEvents:[]},seen=[];
 const route=new Function('assert','audit','measureActivation','percentile','encodeMobileTrace','attributeMobileTasks',`return (${body.trim()});`)(assert,async()=>({...lighthouse,rawTrace}),async()=>{throw new Error('activation failed');},()=>0,()=>({fixture:'compressed'}),()=>({fixture:'attribution'}));
 await assert.rejects(route({url:'http://fixture.invalid/',id:'islands-100',runs:1,onPhase:event=>seen.push(event)}),/activation failed/);
 assert.deepEqual(seen.map(({phase})=>phase),['lighthouse','lighthouse-trace']);
 assert.equal(seen[0].observation.rawLhr,lighthouse.rawLhr);assert.equal(seen[1].observation,rawTrace);
});

test('a failing trace proof still leaves completed raw Lighthouse and trace checkpoints',async()=>{
 const rawTrace={traceEvents:[]},seen=[];
 const route=new Function('assert','audit','measureActivation','percentile','encodeMobileTrace','attributeMobileTasks',`return (${body.trim()});`)(assert,async()=>({rawLhr:'{}',rawTrace}),async()=>{throw new Error('must not start activation');},()=>0,()=>({}),()=>{throw new Error('ambiguous trace identity');});
 await assert.rejects(route({url:'http://fixture.invalid/',id:'islands-100',runs:1,onPhase:event=>seen.push(structuredClone(event))}),/ambiguous trace identity/);
 assert.deepEqual(seen.map(({phase})=>phase),['lighthouse','lighthouse-trace']);assert.deepEqual(seen[1].observation,rawTrace);
});
