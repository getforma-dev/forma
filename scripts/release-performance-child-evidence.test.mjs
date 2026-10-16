import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {createPerformanceJournal,readPerformanceJournal,writePerformanceRecord} from './release-performance-journal.mjs';
import {validateNative} from './release-performance-contract.mjs';
import {native} from './release-performance-test-fixtures.mjs';

test('actual client producer retains the completed metric before its next operation fails',async()=>{
 const parent=mkdtempSync(join(tmpdir(),'forma-client-checkpoint-'));
 try{
  const directory=createPerformanceJournal(parent,{control:'client'}),source=readFileSync(new URL('../e2e/performance/client/run.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('async function runBrowserBenchmark'),source.indexOf('async function openFixture'));
  const metric={samples:Array.from({length:12},()=>({script_ms:1}))};let calls=0;
  const run=new Function('openFixture','sampleOperation','checkpoint',`return (${body.trim()});`)(async()=>({close:async()=>{}}),async()=>{if(calls++===0)return metric;throw new Error('next measurement failed');},(kind,value)=>writePerformanceRecord(directory,kind.replaceAll('_','-'),value));
  await assert.rejects(run({browser:{},browserName:'chromium',origin:'http://fixture.invalid/',broker:{},options:{mountCounts:[1,50],runs:12,warmups:3}}),/next measurement failed/);
  assert.deepEqual(JSON.parse(readFileSync(join(directory,'client-chromium-forma-mount-1.json'),'utf8')),metric);
  assert.equal(readPerformanceJournal(directory).entries.length,2);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('malformed child JSON and failed native validation retain originals without a complete marker',()=>{
 const parent=mkdtempSync(join(tmpdir(),'forma-child-failure-'));
 try{
  const directory=createPerformanceJournal(parent,{control:'native'}),report=native();report.n1[0].walks=1;
  writePerformanceRecord(directory,'native-report',report);
  assert.throws(()=>validateNative(JSON.parse(readFileSync(join(directory,'native-report.json'),'utf8')),{status:'bootstrap'}),/20,000/);
  assert.deepEqual(JSON.parse(readFileSync(join(directory,'native-report.json'),'utf8')),report);
  // A child that dies halfway through a file leaves a deliberately unindexed
  // original; neither parsing nor a new owner may turn it into a complete run.
  assert(!readPerformanceJournal(directory).entries.some(e=>e.kind==='complete'));
  writeFileSync(join(directory,'client-report.json'),'{"browsers":');
  assert.throws(()=>JSON.parse(readFileSync(join(directory,'client-report.json'),'utf8')),SyntaxError);
  assert.equal(readFileSync(join(directory,'client-report.json'),'utf8'),'{"browsers":');
  assert.throws(()=>readPerformanceJournal(directory),/unindexed/);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
