// Pass the executable from cargo test --message-format=json for the isolated
// native journal control crate. This runs a storage control, not a benchmark.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createPerformanceJournal,readPerformanceJournal,writePerformanceRecord,completePerformanceJournal} from '../../../scripts/release-performance-journal.mjs';
const binary=process.argv[2];assert(binary,'native journal test executable required');
const parent=mkdtempSync(join(tmpdir(),'forma-native-kill-')),directory=createPerformanceJournal(parent,{control:'actual-native-bridge'});
let child;
try{
 child=spawn(binary,['--exact','tests::native_journal_interruption_bridge','--nocapture'],{env:{...process.env,FORMA_NATIVE_JOURNAL_CONTROL:directory},stdio:['ignore','pipe','pipe']});
 const closed=once(child,'exit');let output='';const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
 try{
  await Promise.race([new Promise(resolve=>child.stdout.on('data',c=>{output+=c;if(output.includes('native-checkpoint-flushed'))resolve();})),closed.then(status=>{throw new Error('native exited before acknowledgement '+status+' '+output);})]);
  child.kill('SIGKILL');await closed;
 }finally{clearTimeout(timeout);}
 let state=readPerformanceJournal(directory,undefined,{verifyHashes:true});assert.equal(state.entries.length,2);assert.equal(state.entries[1].kind,'native-control-checkpoint');
 assert.deepEqual(JSON.parse(readFileSync(join(directory,'native-control-checkpoint.json'),'utf8')),{samplesNanoseconds:[4,5,6]});
 writePerformanceRecord(directory,'client-control',{samples:[{script_ms:1}]});
 assert.throws(()=>writePerformanceRecord(directory,'next',{}, {records:3,recordBytes:8388608,lhrBytes:33554432,totalBytes:2147483648}),/record count exceeded/);
 state=completePerformanceJournal(directory,{controlPassed:true});assert.equal(state.entries.length,4);
 console.log(JSON.stringify({nativeExecutable:binary,acknowledged:true,killed:true,sharedSequence:state.entries.map(e=>e.sequence),hashes:state.entries.map(e=>e.sha256),result:'passed'}));
}finally{child?.kill('SIGKILL');rmSync(parent,{recursive:true,force:true});}
