#!/usr/bin/env node
// Compile an actual 3.1 renderer in an isolated copy; never change the checkout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const retain=process.argv[2] ? resolve(process.argv[2]) : null;
const work=retain ?? mkdtempSync(join(tmpdir(),'forma-renderer-window-'));
if(retain) mkdirSync(work); // Never overwrite earlier evidence.
const checkout=join(work,'source');mkdirSync(checkout);
const run=(cmd,args,cwd=root,options={})=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],...options});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const report={source:run('git',['rev-parse','HEAD']).trim(),reader:'3.1.0-dev',passed:false};
try {
  const archive=join(work,'source.tar');run('git',['archive','HEAD','--output',archive]);run('tar',['-xf',archive,'-C',checkout]);
  // Exercise current Rust source too when the ordinary local gate runs before a
  // commit. Archive supplies the surrounding package graph without node_modules.
  cpSync(join(root,'crates'),join(checkout,'crates'),{recursive:true});
  for(const file of ['Cargo.toml','Cargo.lock']) cpSync(join(root,file),join(checkout,file));
  report.rustDiff=run('git',['diff','HEAD','--','crates','Cargo.toml','Cargo.lock']).length>0;
  // Read the committed helper, not a concurrently edited source workspace.
  const {versionFiles}=await import(pathToFileURL(join(checkout,'scripts/release-set.mjs')));
  for(const [file,text] of versionFiles(checkout,'3.1.0-dev')) writeFileSync(join(checkout,file),text);
  cpSync(join(root,'scripts/fixtures/renderer-window'),join(checkout,'crates/forma-server/tests/fixtures/renderer-window'),{recursive:true});
  cpSync(join(root,'scripts/fixtures/renderer-window/test.rs'),join(checkout,'crates/forma-server/tests/renderer_window.rs'));
  const lock=join(checkout,'Cargo.lock');report.lockBefore=sha(lock);
  // Reuse compiled external dependencies, with Cargo's ordinary artifact lock.
  // Local package versions participate in artifact identities and remain isolated.
  const env={...process.env,CARGO_TARGET_DIR:resolve(process.env.CARGO_TARGET_DIR ?? join(root,'target'))};
  let output;
  try {output=run('cargo',['test','-p','forma-server','--test','renderer_window','--locked','--','--nocapture'],checkout,{env,maxBuffer:16*1024*1024});}
  catch(error) {writeFileSync(join(work,'test.log'),String(error.stdout??'')+String(error.stderr??''));throw error;}
  writeFileSync(join(work,'test.log'),output);report.lockAfter=sha(lock);assert.equal(report.lockAfter,report.lockBefore,'fixture build changed locked dependencies');
  assert.match(output,/2 passed; 0 failed/);report.passed=true;
  console.log('actual 3.1 renderer: older/same/patch accepted; 3.2 module and manifest refused before bind; locked graph unchanged');
} finally {
  writeFileSync(join(work,'result.json'),JSON.stringify(report,null,2)+'\n');
  if(!retain) rmSync(work,{recursive:true,force:true});
}
