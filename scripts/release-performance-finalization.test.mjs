import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {createPerformanceJournal,readPerformanceJournal,writePerformanceRecord,completePerformanceJournal} from './release-performance-journal.mjs';

test('actual performance producer retains attempt and writes no complete marker when final metadata fails',async()=>{
 const parent=mkdtempSync(join(tmpdir(),'forma-metadata-failure-')),report={},targetDir='/controlled-target';
 const expectedExecutable=join(targetDir,'release','fixture-measure'+(process.platform==='win32'?'.exe':''));
 try{
  const source=readFileSync(new URL('./release-performance.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('export async function verifyPackedPerformance')).replace('export ','');
  const dependencies={assert,join,createHash,createPerformanceJournal,writePerformanceRecord,completePerformanceJournal,ROOT:'/controlled-source',PERFORMANCE_CONTRACT:'measured-v1',
   digest:file=>{if(file===expectedExecutable)throw new Error('final native digest failed');return 'a'.repeat(64);},
   readPerformanceBaseline:async()=>({status:'bootstrap'}),recordPackedDecoder:async()=>({}),run:()=>{},json:()=>({}),validateNative:()=>{},validateMobile:()=>{},
   finalizeMobileAttribution:rows=>assert.deepEqual(rows.map(row=>row.id),['tenant-login','islands-100']),
   withOwnedServer:async(_binary,_args,_project,fn)=>fn(null,'http://fixture.invalid/'),measureMobileRoute:async({id})=>({id,runs:[]}),
   mobileControls:async()=>({controls:{},observations:{}}),machineProfile:()=>({}),completePerformance:()=>({passed:true})};
  const verify=new Function(...Object.keys(dependencies),`return (${body.trim()});`)(...Object.values(dependencies));
  await assert.rejects(verify({staged:{project:'/controlled-project',targetDir},set:{commit:'a'.repeat(40)},test:async(_name,fn)=>fn(),target:{tag:'v3.0.0-beta.1',rehearsal:true},before:'2026-10-16T00:00:00Z',report,evidenceDirectory:parent}),/final native digest failed/);
  assert(report.performanceAttempt,'failed result assembly must keep its attempt');
  const [name]=readdirSync(parent),state=readPerformanceJournal(join(parent,name));
  assert(!state.entries.some(entry=>entry.kind==='complete'),'failed metadata must not mark completion');
 }finally{rmSync(parent,{recursive:true,force:true});}
});
