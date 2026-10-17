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
    mkdirSync(join(root,'scripts'));
    copyFileSync(new URL('./check-builds.sh',import.meta.url),join(root,'scripts/check-builds.sh'));
    const modules=join(layout==='hoisted'?root:core,'node_modules');
    mkdirSync(join(modules,'.bin'),{recursive:true});symlinkSync(esbuild,join(modules,'esbuild'),'junction');
    symlinkSync(join(esbuild,'bin/esbuild'),join(modules,'.bin/esbuild'));
    writeFileSync(join(core,'package.json'),JSON.stringify({private:true,scripts:{build:'node build.cjs'}}));
    writeFileSync(join(core,'build.cjs'),`const fs=require('node:fs');const count=fs.existsSync('build-count')?Number(fs.readFileSync('build-count','utf8')):0;fs.writeFileSync('build-count',String(count+1));fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/formajs-runtime.global.js','globalThis.fixtureRuntime=42;');fs.writeFileSync('dist/forma.esm.js','export const answer=42;');`);
    const result=spawnSync('bash',[join(e2e,'sync-fixtures.sh')],{env:{...process.env,FORMAJS_DIR:core},encoding:'utf8',timeout:30_000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(readFileSync(join(e2e,'fixtures/formajs-runtime.global.js'),'utf8'),'globalThis.fixtureRuntime=42;');
    const context={};runInNewContext(readFileSync(join(e2e,'fixtures/formajs.global.js'),'utf8'),context);
    assert.equal(context.FormaJS.answer,42);
    assert.equal(readFileSync(join(core,'build-count'),'utf8'),'1','standalone sync builds normally');
    // R17's new shell must build again even with dist from the earlier command.
    // Its two fixture consumers then reuse only that fresh, successful build.
    const reused=spawnSync('bash',['-euc',`source scripts/check-builds.sh
      forma_check_build_package "$FORMAJS_DIR" dist/formajs-runtime.global.js dist/forma.esm.js
      (source e2e/sync-fixtures.sh)
      (source e2e/sync-fixtures.sh)`],{cwd:root,env:{...process.env,FORMAJS_DIR:core},encoding:'utf8',timeout:30_000});
    assert.equal(reused.status,0,reused.stdout+reused.stderr);
    assert.equal(readFileSync(join(core,'build-count'),'utf8'),'2','same-invocation fixture sync must not repeat the package build');
    assert.equal(readFileSync(join(e2e,'fixtures/formajs-runtime.global.js'),'utf8'),'globalThis.fixtureRuntime=42;');
    const reusedContext={};runInNewContext(readFileSync(join(e2e,'fixtures/formajs.global.js'),'utf8'),reusedContext);
    assert.equal(reusedContext.FormaJS.answer,42);
  }finally{rmSync(root,{recursive:true,force:true});}
});
