import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launch,processProof} from './run.mjs';

const loader=new URL('./run.mjs',import.meta.url).href;
const read=file=>JSON.parse(readFileSync(file,'utf8'));
function alive(identity){
 try{const now=processProof('identity',String(identity.pid));return now.startSec===identity.startSec&&now.startUsec===identity.startUsec&&now.status!==5;}
 catch{return false;}
}
async function withFixture(mode,body){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'continuation-launch-control-')));
 let unrelated;
 try{
  unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  const unrelatedIdentity=processProof('identity',String(unrelated.pid));
  const childSource=`const {spawn}=require('node:child_process');const leaf=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});process.send({middle:process.pid,leaf:leaf.pid});process.on('message',()=>process.exit(7));setInterval(()=>{},1000);`;
  const source=`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';import {supervisedWorker,processProof} from ${JSON.stringify(loader)};
process.exitCode=await supervisedWorker(async()=>{
 if(${JSON.stringify(mode)}==='abrupt')process.exit(9);
 const middle=spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:['ignore','ignore','ignore','ipc']});
 const ids=await new Promise(resolve=>middle.once('message',resolve));
 writeFileSync(${JSON.stringify(join(root,'pids.json'))},JSON.stringify({worker:process.pid,...ids}));
 if(${JSON.stringify(mode)}==='producer-exit'){
  writeFileSync(${JSON.stringify(join(root,'leaf-identity.json'))},JSON.stringify(processProof('identity',String(ids.leaf))));
  const ended=new Promise(resolve=>middle.once('exit',resolve));middle.send('exit');await ended;throw Error('producer exited unexpectedly');
 }
 process.stdout.write('tree-ready\\n');
 if(${JSON.stringify(mode)}==='timeout'||${JSON.stringify(mode)}==='write-error')await new Promise(()=>{});
 return 0;
});`;
  const file=join(root,'worker.mjs');writeFileSync(file,source);
  await body({root,file,unrelatedIdentity});
  assert(alive(unrelatedIdentity),'unrelated detached process must remain alive');
  const evidence=process.env.FORMA_CONTINUATION_CONTROL_EVIDENCE;
  if(evidence){
   mkdirSync(evidence,{recursive:true});
   for(const name of ['output/launcher-exit.json','pids.json','leaf-identity.json','reparented-leaf-observation.json'])if(existsSync(join(root,name)))copyFileSync(join(root,name),join(evidence,`${mode}-${name.replaceAll('/','-')}`));
   writeFileSync(join(evidence,`${mode}-control.json`),JSON.stringify({mode,unrelatedIdentity,unrelatedAliveAfter:true,finiteOnly:true})+'\n',{flag:'wx'});
  }
 }finally{
  // Even a failing finite assertion must not strand the processes this fixture proved owned.
  const exit=join(root,'output/launcher-exit.json');const identities=existsSync(exit)?read(exit).descendantProof?.captured??[]:[];
  if(existsSync(join(root,'leaf-identity.json')))identities.push(read(join(root,'leaf-identity.json')));
  for(const identity of identities.reverse())if(alive(identity))assert.equal(processProof('shutdown',JSON.stringify(identity),'stop-root').complete,true);
  // The unrelated process is a direct test child, not an ancestry-based discovery.
  if(unrelated){unrelated.kill('SIGKILL');await new Promise(resolve=>unrelated.exitCode!==null||unrelated.signalCode!==null?resolve():unrelated.once('exit',resolve));}
  rmSync(root,{recursive:true});
 }
}
function verifiedExit(root,{incomplete=false}={}){
 const report=read(join(root,'output/launcher-exit.json')),ids=read(join(root,'pids.json'));
 assert.equal(report.descendantProof.complete,!incomplete);assert.equal(report.descendantProof.liveAncestryCleanup,true);assert.equal(report.ownedWorkRemoved,!incomplete);assert.equal(report.workerEnded,true);
 const captured=report.descendantProof.captured;assert.deepEqual(captured.map(p=>p.pid).sort((a,b)=>a-b),Object.values(ids).sort((a,b)=>a-b));
 const middle=captured.find(p=>p.pid===ids.middle),leaf=captured.find(p=>p.pid===ids.leaf);
 assert.equal(leaf.ppid,middle.pid);assert.notEqual(leaf.pgid,captured.find(p=>p.pid===ids.worker).pgid,'actual detached descendant has another PGID');
 for(const identity of captured)assert(!alive(identity),'captured original process must not execute after cleanup');
 if(incomplete){assert(existsSync(report.preservedWork));rmSync(report.preservedWork,{recursive:true});}
 return report;
}
test('normal completion handshake terminates actual detached grandchild and leaves unrelated process alone',async()=>withFixture('normal',async({root,file})=>{
 assert.equal(await launch({output:join(root,'output')},{workerArgs:[file],overallTimeoutMs:5000}),0);
 const report=verifiedExit(root);assert.equal(report.reason,null);assert.equal(report.normalHandshake,true);
}));
test('async capture write error enters durable owned-tree shutdown instead of escaping finally',async()=>withFixture('write-error',async({root,file})=>{
 let writes=0;const code=await launch({output:join(root,'output')},{workerArgs:[file],overallTimeoutMs:5000,writeLog:()=>{writes++;throw Object.assign(Error('injected EIO'),{code:'EIO'});}});
 assert.equal(code,1);assert.equal(writes,1);const report=verifiedExit(root,{incomplete:true});assert.match(report.reason,/log capture failed: injected EIO/);assert.equal(report.normalHandshake,false);
}));
test('timeout captures detached descendants before terminating the live owner',async()=>withFixture('timeout',async({root,file})=>{
 assert.equal(await launch({output:join(root,'output')},{workerArgs:[file],overallTimeoutMs:1000}),1);
 const report=verifiedExit(root,{incomplete:true});assert.equal(report.reason,'overall timeout');assert.equal(report.normalHandshake,false);
}));
test('exited intermediate producer makes detached reparented leaf unproved, never clean',async()=>withFixture('producer-exit',async({root,file})=>{
 let identity;
 try{
  assert.equal(await launch({output:join(root,'output')},{workerArgs:[file],overallTimeoutMs:5000}),1);
  identity=read(join(root,'leaf-identity.json'));assert(alive(identity),'control must actually leave an orphan outside the live worker tree');
  writeFileSync(join(root,'reparented-leaf-observation.json'),JSON.stringify({originalIdentity:identity,currentIdentity:processProof('identity',String(identity.pid)),survivedProducerExit:true,finiteOnly:true}));
  const report=read(join(root,'output/launcher-exit.json'));assert.equal(report.descendantProof.liveAncestryCleanup,true);assert.equal(report.descendantProof.complete,false);assert.equal(report.descendantProof.historicalOwnershipUnproved,true);assert.equal(report.ownedWorkRemoved,false);assert(existsSync(report.preservedWork));
  rmSync(report.preservedWork,{recursive:true});
 }finally{if(identity)assert.equal(processProof('shutdown',JSON.stringify(identity),'stop-root').complete,true);}
}));
test('abrupt worker exit has no authoritative ancestry proof and preserves work as incomplete',async()=>withFixture('abrupt',async({root,file})=>{
 assert.equal(await launch({output:join(root,'output')},{workerArgs:[file],overallTimeoutMs:5000}),1);
 const report=read(join(root,'output/launcher-exit.json'));assert.equal(report.descendantProof.complete,false);assert.equal(report.ownedWorkRemoved,false);assert(existsSync(report.preservedWork));assert.match(report.reason,/before live cleanup handshake/);
 // This finite fixture created no descendants; remove only its recorded owned root.
 rmSync(report.preservedWork,{recursive:true});
}));
test('a stale identity refuses without signalling the PID currently occupying that number',async()=>withFixture('unused',async({unrelatedIdentity})=>{
 const stale={...unrelatedIdentity,startUsec:unrelatedIdentity.startUsec+1};
 const proof=processProof('shutdown',JSON.stringify(stale),'stop-root');assert.equal(proof.complete,false);assert.match(proof.error,/identity changed/);assert(alive(unrelatedIdentity));
}));
