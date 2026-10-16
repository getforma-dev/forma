import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { ROOT, digest, run, stageCargoLock, stageNpmLock, withStagedTemplates } from './release-set.mjs';
import { SEED_MARKER, readTemplateSeeds } from './template-lock-seeds.mjs';

const version = JSON.parse(readFileSync(join(ROOT, 'packages/create-app/package.json'))).version;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-template-source-'));
  const before = new Map();
  const write = (path, text) => { mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,text); };
  write(join(root,SEED_MARKER),readFileSync(join(ROOT,SEED_MARKER)));
  write(join(root,'packages/create-app/package.json'),JSON.stringify({version}));
  copyFileSync(join(ROOT,'Cargo.lock'),join(root,'Cargo.lock'));
  for (const [template,files] of readTemplateSeeds(ROOT,version)) {
    files.set('src/main.rs',readFileSync(join(ROOT,'packages/create-app/templates',template,'src/main.rs'),'utf8'));
    for(const [file,text] of files){const path=join(root,'packages/create-app/templates',template,file);write(path,text);before.set(path,readFileSync(path));}
  }
  const packages=[];
  for(const name of ['core','compiler','build']) {
    const dir=join(root,'npm',name);write(join(dir,'package/package.json'),readFileSync(join(ROOT,'packages',name,'package.json')));
    const file=`${name}.tgz`;run('tar',['-czf',join(root,file),'-C',dir,'package']);
    packages.push({registry:'npm',name:`@getforma/${name}`,version,file,sha256:digest(join(root,file))});
  }
  for(const name of ['forma-ir-derive','forma-ir','forma-server']) {
    const packageDir=`${name}-${version}`, dir=join(root,'crates');
    const dependency=name==='forma-ir'?`forma-ir-derive = "=${version}"\n`:name==='forma-server'?`forma-ir = "=${version}"\n`:'';
    // Only dependency metadata and checksums are under test here. The release
    // acceptance separately compiles both templates against real packed crates.
    write(join(dir,packageDir,'Cargo.toml'),`[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n[dependencies]\n${dependency}`);
    write(join(dir,packageDir,'src/lib.rs'),'');
    const file=`${packageDir}.crate`;run('tar',['-czf',join(root,file),'-C',dir,packageDir]);
    packages.push({registry:'crates',name,version,file,sha256:digest(join(root,file))});
  }
  return {root,before,packages};
}

test('source templates already use finalized typed APIs; packaging never replaces Rust source', () => {
  const {root,before,packages}=fixture();
  try {
    let visited=false;
    withStagedTemplates(root,packages,root,()=>{
      visited=true;
      for(const template of ['minimal','dashboard']) {
        const dir=join(root,'packages/create-app/templates',template), source=join(dir,'src/main.rs');
        const main=readFileSync(source,'utf8');
        assert.deepEqual(readFileSync(source),before.get(source));
        assert(main.indexOf('pages.finalize()')<main.indexOf('tokio::net::TcpListener::bind'));
        assert(!/\b(?:try_render|load_ir_modules_strict|RenderMode|SlotData|config_script)\b/.test(main));
        const manifest=JSON.parse(readFileSync(join(dir,'admin/package.json'))),lock=JSON.parse(readFileSync(join(dir,'admin/package-lock.json')));
        stageNpmLock(manifest,lock,packages,root,true); // Existing strict shipped-lock validator.
        const cargo=readFileSync(join(dir,'Cargo.lock'),'utf8');
        stageCargoLock(cargo,packages,true);
        for(const p of packages.filter(p=>p.registry==='crates'))assert(cargo.includes(`checksum = "${p.sha256}"`));
        const bad=structuredClone(lock);delete bad.packages['node_modules/@getforma/core'].integrity;
        assert.throws(()=>stageNpmLock(manifest,bad,packages,root,true),/shipped template lock/);
        assert.throws(()=>stageCargoLock(cargo.replace(new RegExp('checksum = \"'+packages.find(p=>p.registry==='crates').sha256+'\"\\n'),''),packages,true),/shipped Cargo lock/);
      }
    });
    assert(visited);
    assert.equal(before.size,10);
    for(const [path,bytes]of before)assert.deepEqual(readFileSync(path),bytes,path);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('all ten source, manifest and lock files restore after a packaging callback fails',()=>{
  const {root,before,packages}=fixture();
  try{
    assert.throws(()=>withStagedTemplates(root,packages,root,()=>{
      for(const path of before.keys())writeFileSync(path,'controlled failed pack change');
      throw new Error('controlled pack failure');
    }),/controlled pack failure/);
    for(const [path,bytes]of before)assert.deepEqual(readFileSync(path),bytes,path);
  }finally{rmSync(root,{recursive:true,force:true});}
});
