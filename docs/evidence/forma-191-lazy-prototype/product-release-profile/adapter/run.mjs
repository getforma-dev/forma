#!/usr/bin/env node
// macOS launcher: live-worker handshake and identity-checked descendant shutdown.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {closeSync,copyFileSync,fsyncSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,realpathSync,rmSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {durable,inside,parseOptions,worker} from './adapter.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export function processProof(mode,...args){
 const text=execFileSync('python3',[join(here,'owned-processes.py'),mode,...args],{encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
 return JSON.parse(text);
}
export function cleanupOwned(root,expectedParent){
 assert(inside(expectedParent,root)&&root!==expectedParent&&lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'refuse non-owned cleanup root');
 rmSync(root,{recursive:true});
}
// Dependency injection is finite-test-only; CLI has no replacement-worker/write flags.
export async function launch(options,{workerArgs,writeLog=writeSync,overallTimeoutMs=3600000}={}){
 assert.equal(process.platform,'darwin','external process proof currently supports macOS only');
 mkdirSync(options.output,{mode:0o700});
 const parent=realpathSync(tmpdir()),work=realpathSync(mkdtempSync(join(parent,'forma-continuation-')));
 mkdirSync(join(work,'tmp'));const log=openSync(join(options.output,'worker.log'),'wx',0o600);
 let child,identity,bytes=0,reason=null,code=null,signal=null,proof=null,workerEnded=false,finishing=false,normalHandshake=false,reportedCode=null;
 const shutdown=stopRoot=>{
  if(!identity)return {complete:false,error:'worker identity was not established'};
  try{return processProof('shutdown',JSON.stringify(identity),stopRoot?'stop-root':'keep-root');}
  catch(error){return {complete:false,error:`ownership helper failed: ${error.message}`};}
 };
 let settle,timeout,closeTimeout;
 const ended=new Promise(resolve=>{settle=resolve;});
 const finish=normal=>{
  if(finishing)return;finishing=true;normalHandshake=normal;
  const observed=shutdown(!normal);
  const historicalOwnershipUnproved=!normal||reportedCode===1;
  proof={...observed,liveAncestryCleanup:observed.complete,historicalOwnershipUnproved,complete:observed.complete&&!historicalOwnershipUnproved};
  if(!proof.complete)reason??='owned descendant termination could not be proved';
  if(normal&&observed.complete&&child.connected){
   child.send({kind:'finish'},error=>{if(error){reason??=`completion handshake failed: ${error.message}`;proof={...shutdown(true),complete:false,historicalOwnershipUnproved:true};}});
  }else if(normal){shutdown(true);}
  // A lost child/IPC/pipe cannot prevent the durable incomplete disposition forever.
  closeTimeout=setTimeout(()=>{reason??='worker did not close after shutdown';proof={...proof,complete:false};settle();},3000);
 };
 const stop=why=>{reason??=why;queueMicrotask(()=>finish(false));};
 const interrupted=()=>stop('launcher interrupted');
 process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
 try{
  const files=['adapter.mjs','run.mjs','owned-processes.py','adapter.test.mjs','launcher.test.mjs'];const adapterHashes={};
  mkdirSync(join(options.output,'adapter'));
  for(const file of files){const path=join(here,file);copyFileSync(path,join(options.output,'adapter',file));adapterHashes[file]=createHash('sha256').update(readFileSync(path)).digest('hex');}
  durable(join(options.output,'launch.json'),{...options,adapterHashes,work,startedAt:new Date().toISOString(),overallTimeoutSeconds:overallTimeoutMs/1000,maxLogBytes:64*1024*1024,partialQualification:true,p17Passed:false,performanceAccepted:false});
  child=spawn(process.execPath,workerArgs??[fileURLToPath(import.meta.url),'--worker',JSON.stringify(options),work],{detached:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,TMPDIR:join(work,'tmp'),CARGO_BUILD_JOBS:'3',CARGO_INCREMENTAL:'0'}});
  const capture=data=>{
   if(reason)return;
   try{
    if(bytes+data.length>64*1024*1024)throw Error('log byte limit exceeded');
    let offset=0;while(offset<data.length){const n=writeLog(log,data,offset,data.length-offset);assert(Number.isInteger(n)&&n>0&&n<=data.length-offset,'invalid log write length');offset+=n;bytes+=n;}
   }catch(error){stop(`log capture failed: ${error.message}`);}
  };
  child.stdout.on('data',capture);child.stderr.on('data',capture);
  child.once('error',error=>{stop(`worker spawn failed: ${error.message}`);settle();});
  child.once('exit',(c,s)=>{
   code=c;signal=s;workerEnded=true;
   if(!finishing){reason??='worker exited before live cleanup handshake';proof={complete:false,error:'ancestry unavailable after abrupt worker exit'};finishing=true;closeTimeout=setTimeout(settle,1000);}
  });
  child.once('close',settle);
  child.on('message',value=>{
   try{
    if(value?.kind==='ready'){
     assert(!identity,'duplicate worker ready');identity=processProof('identity',String(child.pid));assert.equal(identity.ppid,process.pid,'worker is not an owned direct child');
     child.send({kind:'start'},error=>{if(error)stop(`start handshake failed: ${error.message}`);});
    }else if(value?.kind==='phases-ended'){
     assert(identity&&!finishing,'unexpected completion message');assert(Number.isInteger(value.code)&&[0,1,2].includes(value.code));
     reportedCode=value.code;
     if(value.code!==0)reason??=`scoped worker result ${value.code}`;
     finish(true);
    }else stop('unknown worker message');
   }catch(error){stop(`worker protocol failed: ${error.message}`);}
  });
  timeout=setTimeout(()=>stop('overall timeout'),overallTimeoutMs);
  await ended;
 }catch(error){reason??=String(error.message);if(child&&!workerEnded){finish(false);await ended;}}
 finally{
  clearTimeout(timeout);clearTimeout(closeTimeout);
  process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);
  // Abrupt/unproved exits preserve work for diagnosis; never claim deletion proves termination.
  let cleanupError=null,removed=false;
  try{fsyncSync(log);}catch(error){reason??=`log flush failed: ${error.message}`;}
  try{closeSync(log);}catch(error){reason??=`log close failed: ${error.message}`;}
  if(proof?.complete&&workerEnded){try{cleanupOwned(work,parent);removed=true;}catch(error){cleanupError=String(error.message);reason??='owned work cleanup failed';}}
  else{reason??='owned shutdown incomplete';cleanupError='preserved work because descendant termination was not proved';}
  // Release local pipes after abnormal exit; they may be held by an unproved orphan.
  child?.stdout?.destroy();child?.stderr?.destroy();if(child?.connected)child.disconnect();child?.unref();
  durable(join(options.output,'launcher-exit.json'),{code,signal,reason,normalHandshake,workerEnded,identity,descendantProof:proof,logBytes:bytes,ownedWorkRemoved:removed,preservedWork:removed?null:work,cleanupError,finishedAt:new Date().toISOString(),p17Passed:false,performanceAccepted:false});
 }
 return reason?1:(code??1);
}

export async function supervisedWorker(run){
 assert(process.send,'worker requires launcher IPC');
 await new Promise(resolve=>{process.once('message',message=>{assert.equal(message?.kind,'start');resolve();});process.send({kind:'ready'});});
 let code=1;try{code=await run();}catch(error){console.error(error.stack??String(error));}
 await new Promise(resolve=>{process.once('message',message=>{assert.equal(message?.kind,'finish');resolve();});process.send({kind:'phases-ended',code});});
 process.disconnect();return code;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=process.argv[2]==='--worker'?await supervisedWorker(()=>worker(JSON.parse(process.argv[3]),process.argv[4])):await launch(parseOptions(process.argv.slice(2)));}
 catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
