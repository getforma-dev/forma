// One sequential owner: P17, then its native child, P17, then its client child.
// Every owner reloads the same manifest; limits never reset between phases.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync,fsyncSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

export const EVIDENCE_LIMITS=Object.freeze({records:256,recordBytes:8*1024*1024,lhrBytes:32*1024*1024,totalBytes:2*1024*1024*1024});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validKind=kind=>typeof kind==='string'&&/^[a-z][a-z0-9-]{0,95}$/.test(kind);
function limitsOf(limits){
 for(const [key,max] of Object.entries(EVIDENCE_LIMITS))assert(Number.isSafeInteger(limits[key])&&limits[key]>0&&limits[key]<=max,`performance evidence: invalid ${key} limit`);
 return limits;
}
function flush(file,bytes,flag){const fd=openSync(file,flag,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
export function readPerformanceJournal(directory,limits=EVIDENCE_LIMITS,{verifyHashes=false}={}){
 limitsOf(limits);assert(isAbsolute(directory)&&lstatSync(directory).isDirectory()&&!lstatSync(directory).isSymbolicLink(),'performance evidence: owned directory required');
 const path=join(directory,'manifest.jsonl');
 assert(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'performance evidence: regular manifest required');
 assert(lstatSync(path).size<=256*1024,'performance evidence: manifest too large');
 const text=readFileSync(path,'utf8');assert(text===''||text.endsWith('\n'),'performance evidence: incomplete manifest');
 const entries=text.trim()?text.trimEnd().split('\n').map(line=>JSON.parse(line)):[];
 assert(entries.length<=limits.records,'performance evidence: record count exceeded');
 const names=new Set(['manifest.jsonl']);let total=0;
 for(const [i,entry] of entries.entries()){
  assert(validKind(entry.kind)&&entry.file===`${entry.kind}.json`,'performance evidence: unsafe record name');
  assert.equal(entry.sequence,i+1,'performance evidence: sequence differs');assert(!names.has(entry.file),'performance evidence: duplicate record');names.add(entry.file);
  const ceiling=entry.kind.startsWith('mobile-lighthouse-')?limits.lhrBytes:limits.recordBytes;
  assert(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=ceiling,'performance evidence: record size exceeded');
  assert.match(entry.sha256??'',/^[a-f0-9]{64}$/,'performance evidence: invalid hash');
  const stat=lstatSync(join(directory,entry.file));assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===entry.bytes,'performance evidence: record bytes differ');
  if(verifyHashes)assert.equal(sha(readFileSync(join(directory,entry.file))),entry.sha256,'performance evidence: record hash differs');
  total+=entry.bytes;assert(total<=limits.totalBytes,'performance evidence: total size exceeded');
 }
 assert.deepEqual(readdirSync(directory).sort(),[...names].sort(),'performance evidence: unindexed output; attempt cannot resume');
 return {entries,totalBytes:total,sha256:sha(Buffer.from(text))};
}
export function writePerformanceRecord(directory,kind,value,limits=EVIDENCE_LIMITS){
 assert(validKind(kind),'performance evidence: unsafe record name');
 const state=readPerformanceJournal(directory,limits);
 assert(state.entries.length===0?kind==='attempt':state.entries[0].kind==='attempt','performance evidence: immutable attempt provenance required');
 assert(!state.entries.some(e=>e.kind==='complete'),'performance evidence: attempt already complete');
 assert(!state.entries.some(e=>e.kind===kind),'performance evidence: duplicate record');
 assert(state.entries.length<limits.records,'performance evidence: record count exceeded');
 const bytes=Buffer.from(JSON.stringify(value)+'\n');
 assert(bytes.length<=(kind.startsWith('mobile-lighthouse-')?limits.lhrBytes:limits.recordBytes),'performance evidence: record size exceeded');
 assert(state.totalBytes+bytes.length<=limits.totalBytes,'performance evidence: total size exceeded');
 const entry={sequence:state.entries.length+1,kind,file:`${kind}.json`,bytes:bytes.length,sha256:sha(bytes)};
 flush(join(directory,entry.file),bytes,'wx');
 // If interrupted here, the immutable unindexed file survives and resume refuses.
 flush(join(directory,'manifest.jsonl'),JSON.stringify(entry)+'\n','a');
 return entry;
}
export function createPerformanceJournal(parent,provenance){
 assert(isAbsolute(parent),'performance evidence: absolute parent required');mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(parent,'performance-attempt-'));
 flush(join(directory,'manifest.jsonl'),'','wx');
 writePerformanceRecord(directory,'attempt',provenance);
 return directory;
}
export function completePerformanceJournal(directory,value){
 // Rehash completed data once, not at every checkpoint. No complete marker is
 // permitted if same-length corruption or an incomplete child output exists.
 readPerformanceJournal(directory,EVIDENCE_LIMITS,{verifyHashes:true});
 writePerformanceRecord(directory,'complete',value);
 return {directory,...readPerformanceJournal(directory)};
}
