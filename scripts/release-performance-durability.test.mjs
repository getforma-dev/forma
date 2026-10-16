import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {recordPackedDecoder} from './release-performance.mjs';
import {decoder} from './release-performance-test-fixtures.mjs';
const provenance={contract:'measured-v1',commit:'a'.repeat(40),targetTag:'v3.0.0-beta.1',rehearsal:true};
test('killing an interrupted producer retains its flushed observation outside disposable fixtures',{timeout:10000},async()=>{
 const directory=mkdtempSync(join(tmpdir(),'forma-decoder-durable-'));
 let child;
 try{
  const module=new URL('./release-performance.mjs',import.meta.url).href;
  const code=`import {recordPackedDecoder} from ${JSON.stringify(module)};
   await recordPackedDecoder({evidenceDirectory:${JSON.stringify(directory)},attempt:{},provenance:${JSON.stringify(provenance)},measure:async({onSample})=>{
    await onSample({id:'test-interruption',phase:'sample',observation:{run:1,elapsedMs:13}});
    process.stdout.write('flushed\\n');await new Promise(()=>setInterval(()=>{},1000));
   }});`;
  child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
  try{
   const [chunk]=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(([code,signal])=>{throw new Error(`producer exited before flush: ${code}/${signal}`);})]);assert.match(String(chunk),/flushed/);
   const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  }finally{clearTimeout(timeout);}
  const [name]=readdirSync(directory);assert(name.startsWith('decoder-attempt-'));
  const files=readdirSync(join(directory,name));assert.deepEqual(files.sort(),['attempt.json','observations.jsonl']);
  const rows=readFileSync(join(directory,name,'observations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows,[{kind:'start',provenance},{kind:'observation',id:'test-interruption',phase:'sample',observation:{run:1,elapsedMs:13}}]);
  assert.deepEqual(JSON.parse(readFileSync(join(directory,name,'attempt.json'),'utf8')),provenance);
 }finally{child?.kill('SIGKILL');rmSync(directory,{recursive:true,force:true});}
});
test('complete failing evidence is flushed before the timing validator refuses',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'forma-decoder-complete-')),attempt={},report=decoder();
 report.cases[1].samples[0].elapsedMs=15;
 try{
  await assert.rejects(recordPackedDecoder({evidenceDirectory:directory,attempt,provenance,measure:async({onSample})=>{
   await onSample({id:report.cases[1].id,phase:'sample',observation:report.cases[1].samples[0]});return report;
  }}),/exceeds 12ms/);
  assert.deepEqual(JSON.parse(readFileSync(attempt.decoderEvidence.complete,'utf8')),report);
  assert.equal(attempt.decoderObservations.length,1);assert.equal(attempt.decoder,report);
  assert.equal(readdirSync(directory).length,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
