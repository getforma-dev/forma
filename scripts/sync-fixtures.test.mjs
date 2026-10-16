import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,symlinkSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';

const require=createRequire(import.meta.url);
const esbuild=dirname(require.resolve('esbuild/package.json'));
const script=new URL('../e2e/sync-fixtures.sh',import.meta.url);

for(const layout of ['hoisted','package-local'])test(`fixture sync uses the real bundler from a ${layout} install`,()=>{
  const root=mkdtempSync(join(tmpdir(),'forma fixture sync '));
  try{
    const core=join(root,'packages/core'),e2e=join(root,'e2e');
    mkdirSync(core,{recursive:true});mkdirSync(join(e2e,'fixtures'),{recursive:true});
    copyFileSync(script,join(e2e,'sync-fixtures.sh'));
    const modules=join(layout==='hoisted'?root:core,'node_modules');
    mkdirSync(join(modules,'.bin'),{recursive:true});symlinkSync(esbuild,join(modules,'esbuild'),'junction');
    symlinkSync(join(esbuild,'bin/esbuild'),join(modules,'.bin/esbuild'));
    writeFileSync(join(core,'package.json'),JSON.stringify({private:true,scripts:{build:'node build.cjs'}}));
    writeFileSync(join(core,'build.cjs'),`const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/formajs-runtime.global.js','globalThis.fixtureRuntime=42;');fs.writeFileSync('dist/forma.esm.js','export const answer=42;');`);
    const result=spawnSync('bash',[join(e2e,'sync-fixtures.sh')],{env:{...process.env,FORMAJS_DIR:core},encoding:'utf8',timeout:30_000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(readFileSync(join(e2e,'fixtures/formajs-runtime.global.js'),'utf8'),'globalThis.fixtureRuntime=42;');
    const context={};runInNewContext(readFileSync(join(e2e,'fixtures/formajs.global.js'),'utf8'),context);
    assert.equal(context.FormaJS.answer,42);
  }finally{rmSync(root,{recursive:true,force:true});}
});
