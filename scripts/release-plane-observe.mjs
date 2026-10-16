#!/usr/bin/env node
// Read-only collector. Baseline is an input; this process never overwrites it.
// The external delivery owner promotes the candidate only after delivery.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {REPOSITORY,NPM_PACKAGES,environmentSnapshot,settingsAlerts,registrySnapshot,registryAlerts,classifyEvent} from './release-plane-events.mjs';

const args=process.argv.slice(2),mode=args.shift(),options=new Map();
assert(['environments','npm','event'].includes(mode),'usage: release-plane-observe.mjs environments|npm|event --out PATH [--baseline PATH] [--kind EVENT --payload PATH --paths PATH --delivery ID]');
while(args.length){const key=args.shift(),value=args.shift();assert(/^--(?:out|baseline|kind|payload|paths|delivery)$/.test(key??'')&&value&&!options.has(key),'invalid or duplicate option');options.set(key,value);}
assert(options.has('--out'),'an explicit output file is required');
const out=resolve(options.get('--out'));assert(!existsSync(out),'preserve prior output; use a new file');mkdirSync(dirname(out),{recursive:true});
const previous=options.has('--baseline')?JSON.parse(readFileSync(resolve(options.get('--baseline')),'utf8')):null;
const report={schema:1,repository:REPOSITORY,mode,recordedAt:new Date().toISOString(),complete:false,delivered:false};
function api(path){return JSON.parse(execFileSync('gh',['api',`repos/${REPOSITORY}/${path}`],{encoding:'utf8',timeout:20_000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}
function pages(path,key){
 const rows=[];let expected;
 for(let page=1;page<=100;page++){
  const doc=api(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
  assert(Array.isArray(doc[key])&&Number.isSafeInteger(doc.total_count)&&doc.total_count>=0,'malformed paginated settings');
  expected??=doc.total_count;assert.equal(doc.total_count,expected,'settings changed during pagination');rows.push(...doc[key]);
  if(rows.length===expected)return rows;
  assert(doc[key].length>0&&rows.length<expected,'incomplete or inconsistent pagination');
 }
 throw new Error('settings pagination exceeds bounded collector');
}
try {
 if(mode==='environments'){
  const environments=pages('environments','environments');
  const details=environments.map(row=>{
   assert(typeof row.name==='string'&&row.name,'missing environment name');
   const path=`environments/${encodeURIComponent(row.name)}`,item=api(path);
   assert.equal(item.name,row.name);
   const branchPolicies=item.deployment_branch_policy?.custom_branch_policies?pages(`${path}/deployment-branch-policies`,'branch_policies'):[];
   return {...item,branchPolicies};
  });
  report.snapshot=environmentSnapshot(details);report.alerts=settingsAlerts(previous,report.snapshot);
 }else if(mode==='npm'){
  assert(!process.env.GITHUB_ACTIONS,'the npm outside signal must run outside GitHub Actions');
  const docs={};
  for(const name of NPM_PACKAGES){
   const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20_000)});
   assert.equal(response.status,200,`npm ${name}: HTTP ${response.status}`);
   const chunks=[];let bytes=0;
   for await(const chunk of response.body){bytes+=chunk.length;assert(bytes<=16*1024*1024,'npm response exceeds bound');chunks.push(chunk);}
   docs[name]=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  report.snapshot=registrySnapshot(docs);report.alerts=registryAlerts(previous,report.snapshot);
 }else{
  assert(options.has('--kind')&&options.has('--payload')&&options.has('--delivery'),'event inputs required');
  report.alerts=classifyEvent(options.get('--kind'),JSON.parse(readFileSync(options.get('--payload'),'utf8')),{delivery:options.get('--delivery'),changedPaths:options.has('--paths')?JSON.parse(readFileSync(options.get('--paths'),'utf8')):undefined});
 }
 report.complete=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(out);}
