import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acquire, filesIn, hash, readJSON, safePath, writeJSON } from './session.mjs';

export function dependencyInventory(root) {
  const manifests=['client-race','signals-race','island-race','contestants'].flatMap(d=>filesIn(path.join(root,d))).filter(f=>path.basename(f)==='package.json');
  return manifests.flatMap(file=>{
    const pkg=readJSON(file), lock=path.join(path.dirname(file),'package-lock.json');
    const resolved=fs.existsSync(lock)?readJSON(lock).packages:{};
    return ['dependencies','devDependencies'].flatMap(section=>Object.entries(pkg[section]||{}).map(([name,requested])=>({manifest:path.relative(root,file),section,name,requested,resolved:resolved?.['node_modules/'+name]?.version||null,integrity:resolved?.['node_modules/'+name]?.integrity||null})));
  }).sort((a,b)=>a.name.localeCompare(b.name)||a.manifest.localeCompare(b.manifest));
}
export async function checkUpdates(root) {
  const dependencies=dependencyInventory(root), names=[...new Set(dependencies.map(d=>d.name))], packages=[];
  // Registry metadata only: no install scripts or source changes during an audit.
  for(const name of names) {
    const url='https://registry.npmjs.org/'+encodeURIComponent(name)+'/latest';
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      const p=await response.json();
      packages.push({name,latest:p.version,integrity:p.dist?.integrity||null,engines:p.engines||null,source:url});
    } catch(e){packages.push({name,error:e.message,source:url});}
  }
  return {schemaVersion:1,checkedAt:new Date().toISOString(),scope:'npm direct dependencies; Rust, browser and Docker pins are separate reviewed inputs',packages,
    dependencies:dependencies.map(d=>({...d,latest:packages.find(p=>p.name===d.name)?.latest||null,updateAvailable:packages.find(p=>p.name===d.name)?.latest&&d.resolved ? packages.find(p=>p.name===d.name).latest!==d.resolved : null})),
    policy:'New dependency cohorts require correctness and a fresh complete comparison; original locked baselines and historical evidence remain frozen.'};
}
function stageUpdateUnlocked(root,name,version) {
  if(!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name||'')||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version||''))throw Error('Supply an npm package and exact version; tags/ranges are not accepted');
  const entries=dependencyInventory(root).filter(d=>d.name===name);
  if(!entries.length)throw Error('Package is not registered in any entrant manifest');
  const id='update-'+randomUUID(),dir=safePath(root,path.join('updates',id));fs.mkdirSync(dir,{recursive:true});
  const receipt={schemaVersion:1,id,name,version,createdAt:new Date().toISOString(),status:'preparing',changes:[],validation:'Not run. Review dependency changes and qualify all affected workloads before comparing performance.'};
  writeJSON(path.join(dir,'update.json'),receipt,true);
  try {
    for(const manifest of [...new Set(entries.map(d=>d.manifest))]) {
      const destination=path.join(dir,path.dirname(manifest));fs.mkdirSync(destination,{recursive:true});
      const originals=['package.json','package-lock.json'].map(file=>path.join(path.dirname(manifest),file));
      for(const relative of originals) {const source=safePath(root,relative);if(!fs.existsSync(source))throw Error('Lockfile missing: '+relative);fs.copyFileSync(source,path.join(dir,relative));const before=path.join(dir,'before',relative);fs.mkdirSync(path.dirname(before),{recursive:true});fs.copyFileSync(source,before);}
      const pkg=readJSON(path.join(destination,'package.json'));
      for(const section of ['dependencies','devDependencies'])if(pkg[section]?.[name])pkg[section][name]=version;
      writeJSON(path.join(destination,'package.json'),pkg);
      const proc=spawnSync('npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],{cwd:destination,encoding:'utf8',timeout:120000,maxBuffer:4*1024**2});
      fs.writeFileSync(path.join(destination,'resolution.log'),(proc.stdout||'')+(proc.stderr||''));
      if(proc.status!==0)throw Error('Lock resolution failed for '+manifest+'; inspect '+path.join(destination,'resolution.log'));
      for(const relative of originals)receipt.changes.push({path:relative,beforeSha256:hash(fs.readFileSync(path.join(root,relative))),afterSha256:hash(fs.readFileSync(path.join(dir,relative)))});
    }
    receipt.status='staged';
  }catch(e){receipt.status='failed';receipt.error=e.message;throw e;}
  finally{writeJSON(path.join(dir,'update.json'),receipt);}
  return receipt;
}
function applyUpdateUnlocked(root,id) {
  if(!/^update-[a-f0-9-]{36}$/.test(id||''))throw Error('Invalid staged update ID');
  const dir=safePath(root,path.join('updates',id)),receipt=readJSON(path.join(dir,'update.json'));
  if(receipt.status!=='staged'||receipt.id!==id)throw Error('Update is not staged');
  const allowed=new Set(dependencyInventory(root).flatMap(d=>[d.manifest,path.join(path.dirname(d.manifest),'package-lock.json')]));
  const backups=[];
  for(const change of receipt.changes) {
    if(!allowed.has(change.path))throw Error('Unregistered update target');
    const file=safePath(root,change.path),candidate=safePath(dir,change.path);
    const bytes=fs.readFileSync(file),updated=fs.readFileSync(candidate);
    if(hash(bytes)!==change.beforeSha256 || hash(updated)!==change.afterSha256)throw Error('Inputs changed since staging: '+change.path);
    const baseline=safePath(dir,path.join('before',change.path));
    if(fs.existsSync(baseline)&&hash(fs.readFileSync(baseline))!==change.beforeSha256)throw Error('Staged recovery baseline changed');
    if(!fs.existsSync(baseline)){fs.mkdirSync(path.dirname(baseline),{recursive:true});fs.writeFileSync(baseline,bytes,{flag:'wx'});}
    backups.push({file,bytes,updated});
  }
  const audit=safePath(root,path.join('config','updates',id+'.json'));
  if(fs.existsSync(audit))throw Error('Update already has an audit receipt');
  const originalReceipt=fs.readFileSync(path.join(dir,'update.json'));
  fs.mkdirSync(path.dirname(audit),{recursive:true});
  // Durable intent precedes mutation; the exact old/new bytes already live in the proposal.
  writeJSON(path.join(dir,'apply-intent.json'),{id,at:new Date().toISOString(),changes:receipt.changes});
  try {
    for(const item of backups)fs.writeFileSync(item.file,item.updated);
    receipt.status='applied-unqualified';receipt.appliedAt=new Date().toISOString();
    writeJSON(audit,receipt,true);writeJSON(path.join(dir,'update.json'),receipt);
  } catch(e){
    for(const item of backups)fs.writeFileSync(item.file,item.bytes);
    fs.writeFileSync(path.join(dir,'update.json'),originalReceipt);
    if(fs.existsSync(audit))fs.unlinkSync(audit);
    throw e;
  }
  return receipt;
}
export function stageUpdate(root,name,version) {
  const release=acquire(root,'update-'+randomUUID(),{operation:'update'});
  try{return stageUpdateUnlocked(root,name,version);}finally{release();}
}
export function applyUpdate(root,id) {
  const release=acquire(root,'update-'+randomUUID(),{operation:'update'});
  try{return applyUpdateUnlocked(root,id);}finally{release();}
}
