// Temporary opt-in navigation observations. No request routing or timed-workload changes.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

function processSnapshot(){
 const rows=execFileSync('ps',['-eo','pid=,ppid=,stat=,comm='],{encoding:'utf8',timeout:3000,maxBuffer:4*1024*1024}).trim().split('\n').map(line=>{
  const [pid,ppid,state,...command]=line.trim().split(/\s+/);return {pid:Number(pid),ppid:Number(ppid),state,command:command.join(' ')};
 });
 const owned=new Set([process.ppid,process.pid]);let added;
 do{added=false;for(const row of rows)if(owned.has(row.ppid)&&!owned.has(row.pid)){owned.add(row.pid);added=true;}}while(added);
 const read=path=>{try{return readFileSync(path,'utf8').slice(0,16384);}catch(error){return {unavailable:error.code};}};
 return {owner:process.ppid,worker:process.pid,processes:rows.filter(row=>owned.has(row.pid)),limits:read('/proc/self/limits'),pidsCurrent:read('/sys/fs/cgroup/pids.current'),pidsMax:read('/sys/fs/cgroup/pids.max')};
}

export function createNavigationDiagnostic(directory,{snapshot=processSnapshot,write=writeFileSync}={}){
 if(!directory)return null;
 assert(isAbsolute(directory),'diagnostic directory must be absolute');mkdirSync(directory);
 let totalBytes=0,sequence=0,active=null,engine=null;
 const lifecycle=[];const browserOff=[];
 const save=(name,value)=>{
  const bytes=Buffer.from(JSON.stringify(value)+'\n');
  assert(bytes.length<=1024*1024,'diagnostic file bound');
  assert(totalBytes+bytes.length<=8*1024*1024,'diagnostic total bound');
  write(join(directory,name),bytes,{flag:'wx'});totalBytes+=bytes.length;
 };
 const bounded=value=>{const text=JSON.stringify(value);return Buffer.byteLength(text)>16384?{omitted:true,originalBytes:Buffer.byteLength(text)}:value;};
 const life=value=>{assert(lifecycle.length<128,'diagnostic lifecycle bound');lifecycle.push(bounded(value));};
 return {
  engine(name,phase){engine=name;save(name+'-'+phase+'.json',{engine:name,phase,at:Date.now(),snapshot:snapshot()});},
  browser(browser,name){const onDisconnect=()=>life({event:'browser-disconnected',engine:name,at:Date.now()});browser.on('disconnected',onDisconnect);browserOff.push(()=>browser.off('disconnected',onDisconnect));life({event:'browser-launched',engine:name,version:browser.version(),at:Date.now()});},
  request(request,response){
   const current=active;if(!current)return;
   current.add('server-request',{method:request.method,url:request.url});
   for(const event of ['finish','close'])current.on(response,event,()=>current.add('server-response-'+event,{status:response.statusCode,contentType:response.getHeader('content-type'),coop:response.getHeader('cross-origin-opener-policy'),coep:response.getHeader('cross-origin-embedder-policy')}));
  },
  navigation(page,browser,bundle){
   assert(!active,'overlapping diagnostic navigation');
   const events=[],offs=[];let bytes=0,droppedEvents=0,omittedData=0,finished=false;
   const current={
    add(event,data={}){const body=bounded(data);if(body.omitted)omittedData++;const row={at:Date.now(),event,data:body},size=Buffer.byteLength(JSON.stringify(row));if(events.length>=512||bytes+size>512*1024){droppedEvents++;return;}events.push(row);bytes+=size;},
    on(target,event,fn){target.on(event,fn);offs.push(()=>target.off(event,fn));},
    finish(error){
     if(finished)return;finished=true;for(const off of offs)off();active=null;
     const outcome=bounded({passed:!error,error:error?String(error.stack??error):null,url:page.url(),pageClosed:page.isClosed(),browserConnected:browser.isConnected()});
     current.add('outcome',outcome);
     save(String(++sequence).padStart(2,'0')+'-'+engine+'-'+bundle+'.json',{engine,bundle,passed:!error,outcome,droppedEvents,omittedData,events});
    }
   };active=current;
   current.on(page,'request',request=>current.add('request',{url:request.url(),method:request.method(),type:request.resourceType()}));
   current.on(page,'response',response=>{const h=response.headers();current.add('response',{url:response.url(),status:response.status(),contentType:h['content-type'],coop:h['cross-origin-opener-policy'],coep:h['cross-origin-embedder-policy']});});
   current.on(page,'requestfailed',request=>current.add('requestfailed',{url:request.url(),error:request.failure()}));
   current.on(page,'framenavigated',frame=>{if(frame===page.mainFrame())current.add('main-frame-navigation',{url:frame.url()});});
   current.on(page,'pageerror',error=>current.add('pageerror',{message:String(error.stack??error)}));
   current.on(page,'console',message=>{if(message.type()==='error')current.add('console-error',{message:message.text()});});
   for(const event of ['domcontentloaded','load','crash','close'])current.on(page,event,()=>current.add(event));
   current.add('begin',{url:page.url(),bundle});return current;
  },
  finish(){for(const off of browserOff)off();save('browser-lifecycle.json',{events:lifecycle});}
 };
}

export function finishDiagnostic(operation,originalError,{reportError=error=>console.error('Navigation diagnostic write failed:',error)}={}){
 try{operation();}catch(error){if(originalError)reportError(error);else throw error;}
}

export async function observeNavigation(diagnostic,page,browser,bundle,operation,{reportError=error=>console.error('Navigation diagnostic write failed:',error)}={}){
 if(!diagnostic)return operation();
 const observation=diagnostic.navigation(page,browser,bundle);
 let result;
 try{result=await operation();}
 catch(error){finishDiagnostic(()=>observation.finish(error),error,{reportError});throw error;}
 observation.finish(null);return result;
}
