import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root='/Users/victorvillacis/dev/Forma/work/FORMA-191-lazy-prototype/forma';
const [profile,output]=process.argv.slice(2);
assert(['debug','release'].includes(profile),'invalid profile');assert(output,'missing output');
const binary=join(root,'e2e/target',profile,'fixture-fauth');
const index=JSON.parse(await readFile(join(root,'e2e/fixtures/apps/apps.json'),'utf8'));
const path=index.apps.fauth.routes['/t/:slug/login'].path;
assert(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const binaryHash=digest(await readFile(binary));
const child=spawn(binary,[],{cwd:root,env:{...process.env,FORMA_PORT:'0'},stdio:['ignore','pipe','pipe']});
let log='';const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
try{
 const origin=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('fixture never reported its owned address')),20000);
  const consume=bytes=>{log+=bytes.toString();if(Buffer.byteLength(log)>65536){clearTimeout(timeout);reject(Error('fixture output bound'));return;}const match=/^FORMA_LISTENING (http:\/\/127\.0\.0\.1:\d+)\r?$/m.exec(log.replace(/\x1b\[[0-9;]*m/g,''));if(match){clearTimeout(timeout);resolve(match[1]);}};
  child.stdout.on('data',consume);child.stderr.on('data',consume);
  child.once('error',error=>{clearTimeout(timeout);reject(error)});
  child.once('exit',code=>{clearTimeout(timeout);reject(Error('fixture exited before capture: '+code))});
 });
 const response=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(10000)});
 const body=Buffer.from(await response.arrayBuffer());
 const headers=Object.fromEntries(response.headers);
 const report={profile,binary,binarySha256:binaryHash,path,origin,status:response.status,headers,bodyBytes:body.length,bodySha256:digest(body),capturedAt:new Date().toISOString()};
 await writeFile(output+'.html',body,{flag:'wx'});await writeFile(output+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 assert.equal(response.status,200);assert(body.length<1024*1024);
 assert(headers['content-security-policy'].includes("require-trusted-types-for 'script'"));
}finally{
 if(child.exitCode===null)child.kill('SIGTERM');const exit=await closed;
 await writeFile(output+'.server.json',JSON.stringify({binary,profile,log,exit},null,2)+'\n',{flag:'wx'});
}
