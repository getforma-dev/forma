import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createPerformanceJournal,readPerformanceJournal,writePerformanceRecord,completePerformanceJournal,EVIDENCE_LIMITS} from './release-performance-journal.mjs';

const provenance={commit:'a'.repeat(40),targetTag:'v3.0.0-beta.1',rehearsal:true};
function fixture(fn){const parent=mkdtempSync(join(tmpdir(),'forma-evidence-control-'));try{return fn(createPerformanceJournal(parent,provenance));}finally{rmSync(parent,{recursive:true,force:true});}}
test('sequential owners resume the same limits and immutable exact byte hashes',()=>fixture(directory=>{
 writePerformanceRecord(directory,'native-n1-300',{samplesNanoseconds:[1,2,3]});
 writePerformanceRecord(directory,'mobile-lighthouse-islands-100-1',{rawLhr:'{"complete":true}'});
 writePerformanceRecord(directory,'client-chromium-forma-mount-1',{samples:[{script_ms:1}]});
 const state=readPerformanceJournal(directory);assert.equal(state.entries.length,4);
 for(const e of state.entries){const bytes=readFileSync(join(directory,e.file));assert.equal(bytes.length,e.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),e.sha256);}
 assert.throws(()=>writePerformanceRecord(directory,'client-next',{}, {...EVIDENCE_LIMITS,records:4}),/record count exceeded/);
 assert.throws(()=>writePerformanceRecord(directory,'client-next',{}, {...EVIDENCE_LIMITS,totalBytes:state.totalBytes+2}),/total size exceeded/);
 assert.throws(()=>writePerformanceRecord(directory,'attempt',{}),/duplicate/);
 writePerformanceRecord(directory,'complete',{passed:true});
 assert.throws(()=>writePerformanceRecord(directory,'late',{}),/already complete/);
}));
test('unsafe, oversized, unindexed and truncated records refuse without overwrite',()=>fixture(directory=>{
 for(const kind of ['../escape','a/b','A','x'.repeat(97),''])assert.throws(()=>writePerformanceRecord(directory,kind,{}),/unsafe/);
 const state=readPerformanceJournal(directory),before=readdirSync(directory);
 assert.throws(()=>writePerformanceRecord(directory,'large',{data:'x'.repeat(1024)},{...EVIDENCE_LIMITS,recordBytes:512}),/record size/);
 assert.deepEqual(readdirSync(directory),before);
 writeFileSync(join(directory,'orphan.json'),'partial');
 assert.throws(()=>writePerformanceRecord(directory,'after-orphan',{}),/unindexed/);
 rmSync(join(directory,'orphan.json'));
 writeFileSync(join(directory,'manifest.jsonl'),JSON.stringify(state.entries[0]));
 assert.throws(()=>readPerformanceJournal(directory),/incomplete/);
}));
test('same-length corruption cannot receive a completed manifest',()=>fixture(directory=>{
 writePerformanceRecord(directory,'native-report',{samples:[1,2,3]});
 const path=join(directory,'native-report.json'),bytes=readFileSync(path,'utf8');
 writeFileSync(path,bytes.replace('1,2,3','9,2,3'));
 assert.throws(()=>completePerformanceJournal(directory,{passed:true}),/record hash differs/);
 assert(!readPerformanceJournal(directory).entries.some(e=>e.kind==='complete'));
}));
test('real SIGKILL preserves acknowledged raw LHR and completed native/client checkpoints',{timeout:10000},async()=>{
 const parent=mkdtempSync(join(tmpdir(),'forma-evidence-kill-')),directory=createPerformanceJournal(parent,provenance);
 let child;const stderr=[];
 try{
  const code=`import {writePerformanceRecord} from ${JSON.stringify(new URL('./release-performance-journal.mjs',import.meta.url).href)};
   const directory=${JSON.stringify(directory)};
   writePerformanceRecord(directory,'native-n1-300',{samplesNanoseconds:[1,2,3]});
   writePerformanceRecord(directory,'mobile-lighthouse-islands-100-1',{rawLhr:'{"completed":true}'});
   writePerformanceRecord(directory,'client-chromium-forma-mount-1',{samples:[{script_ms:1}]});
   process.stdout.write('flushed\\n');setInterval(()=>{},1000);`;
  child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});child.stderr.on('data',chunk=>stderr.push(chunk));
  const closed=once(child,'exit');const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
  try{const [chunk]=await Promise.race([once(child.stdout,'data'),closed.then(status=>{throw new Error(`child exited early ${status}: ${Buffer.concat(stderr)}`);})]);assert.match(String(chunk),/flushed/);child.kill('SIGKILL');await closed;}finally{clearTimeout(timeout);}
  const state=readPerformanceJournal(directory);assert.equal(state.entries.length,4);assert(!state.entries.some(e=>e.kind==='complete'));
  for(const e of state.entries)assert.equal(createHash('sha256').update(readFileSync(join(directory,e.file))).digest('hex'),e.sha256);
  assert.deepEqual(JSON.parse(readFileSync(join(directory,'attempt.json'),'utf8')),provenance);
  assert.equal(JSON.parse(readFileSync(join(directory,'mobile-lighthouse-islands-100-1.json'),'utf8')).rawLhr,'{"completed":true}');
 }finally{child?.kill('SIGKILL');rmSync(parent,{recursive:true,force:true});}
});
