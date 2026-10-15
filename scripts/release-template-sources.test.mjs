import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run } from './release-set.mjs';
import { verifyPackedTemplateSources } from './release-template-sources.mjs';
function fixture(visit) {
  const root=mkdtempSync(join(tmpdir(),'forma-template-sources-')), cli=join(root,'packed');
  const write=(path,text)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};
  try {
    for(const name of ['minimal','dashboard'])for(const path of ['src/main.rs','admin/src/home/app.tsx','admin/build.ts','README.md','Cargo.toml','Cargo.lock','admin/package.json','admin/package-lock.json'])write(join(root,'packages/create-app/templates',name,path),`${name}/${path}\n`);
    write(join(root,'packages/create-app/templates/minimal/admin/src/about/app.tsx'),'static About\n');
    run('git',['init','--quiet'],root);run('git',['add','packages'],root);
    run('git',['-c','user.name=Codex','-c','user.email=codex@openai.com','commit','--quiet','-m','fixed template sources'],root);
    const commit=run('git',['rev-parse','HEAD'],root).trim();
    cpSync(join(root,'packages/create-app/templates'),join(cli,'templates'),{recursive:true});
    return visit({root,cli,commit,write});
  } finally {rmSync(root,{recursive:true,force:true});}
}
test('islands template capability verifies all exact sources while dependency staging remains separate',()=>fixture(({root,cli,commit,write})=>{
  write(join(cli,'templates/minimal/Cargo.lock'),'sealed candidate checksums\n');
  const result=verifyPackedTemplateSources(cli,commit,'islands-v1',root);
  assert.equal(result.files.length,9);assert(result.files.some(file=>file.path==='minimal/admin/src/about/app.tsx'));
}));
test('islands template capability refuses a changed static source and an extra runtime file',()=>fixture(({root,cli,commit,write})=>{
  const about=join(cli,'templates/minimal/admin/src/about/app.tsx');write(about,'changed static source\n');
  assert.throws(()=>verifyPackedTemplateSources(cli,commit,'islands-v1',root),/packed source differs/);
  write(about,'static About\n');write(join(cli,'templates/minimal/admin/src/extra.ts'),'extra runtime\n');
  assert.throws(()=>verifyPackedTemplateSources(cli,commit,'islands-v1',root),/inventory differs/);
}));
test('historical declared source verification remains available and unknown capabilities refuse',()=>fixture(({root,cli,commit})=>{
  assert.equal(verifyPackedTemplateSources(cli,commit,'declared-v1',root).files.length,3);
  assert.throws(()=>verifyPackedTemplateSources(cli,commit,'future-v99',root),/unknown source template/);
}));
