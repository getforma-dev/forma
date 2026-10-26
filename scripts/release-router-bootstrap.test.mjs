import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { cleanPublishEnvironment, routerBootstrapToken, publishNpmPackage } from './release-publish.mjs';
const parse = text => JSON.parse(execFileSync('ruby', ['-rjson', '-ryaml', '-e', 'puts JSON.generate(YAML.load(STDIN.read))'], {input:text,encoding:'utf8'}));
const TOKEN = 'finite-test-token-not-a-credential';
const router = {registry:'npm',name:'@getforma/router',version:'3.2.0-rc.1'};
const set = {dryRun:false,tag:'v3.2.0-rc.1',commit:'a'.repeat(40),run:'42',packages:[router]};
const environment = {...process.env, GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REPOSITORY:'getforma-dev/forma',GITHUB_REF_NAME:set.tag,GITHUB_SHA:set.commit,GITHUB_RUN_ID:'42',NPM_ROUTER_BOOTSTRAP_TOKEN:TOKEN,NODE_AUTH_TOKEN:'unrelated-token'};
const absent = async (url,options) => {assert.equal(url,'https://registry.npmjs.org/%40getforma%2Frouter');assert.deepEqual(Object.keys(options.headers),['User-Agent']);return {status:404};};

test('first-router token needs exact non-dry rc.1 push identity and whole package absence', async () => {
  assert.equal(await routerBootstrapToken(set,[router],environment,absent),TOKEN);
  for (const edit of [
    value => {value.dryRun=true;}, value => {value.tag='v3.2.0-rc.2';},
    value => {value.commit='b'.repeat(40);}, value => {value.run='43';},
    value => {value.packages[0].name='@getforma/core';}, value => {value.packages[0].registry='crates';},
    value => {value.packages[0].version='3.2.0';}, value => {value.packages=[];},
  ]) {const changed=structuredClone(set);edit(changed);await assert.rejects(routerBootstrapToken(changed,[router],environment,()=>{throw Error('network must not run');}));}
  for(const [key,value] of Object.entries({GITHUB_ACTIONS:'false',GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:'other/forma',GITHUB_REF_NAME:'v3.2.0-rc.2',GITHUB_SHA:'b'.repeat(40),GITHUB_RUN_ID:'43'}))
    await assert.rejects(routerBootstrapToken(set,[router],{...environment,[key]:value},()=>{throw Error('network must not run');}));
  for(const status of [200,401,403,429,500]) await assert.rejects(routerBootstrapToken(set,[router],environment,async()=>({status})),/absent package/);
  await assert.rejects(routerBootstrapToken(set,[router],environment,async()=>{throw Error('registry unavailable');}),/registry unavailable/);
});
test('missing secret keeps normal OIDC and verified already-present rc.1 never uses bootstrap', async () => {
  const unexpected = () => {throw Error('unexpected registry request');};
  assert.equal(await routerBootstrapToken(set,[router],{...environment,NPM_ROUTER_BOOTSTRAP_TOKEN:''},unexpected),undefined);
  assert.equal(await routerBootstrapToken(set,[],environment,unexpected),undefined);
  // A secret supplied to a later release is refused even when nothing is pending.
  await assert.rejects(routerBootstrapToken({...set,tag:'v3.2.0-rc.2'},[],environment,unexpected));
});
test('all normal publisher child environments exclude both token variables', () => {
  const clean=cleanPublishEnvironment(environment);
  assert(!Object.hasOwn(clean,'NPM_ROUTER_BOOTSTRAP_TOKEN')); assert(!Object.hasOwn(clean,'NODE_AUTH_TOKEN'));
  // A real child proves absence rather than merely comparing an intended object.
  execFileSync(process.execPath,['-e',"if ('NODE_AUTH_TOKEN' in process.env || 'NPM_ROUTER_BOOTSTRAP_TOKEN' in process.env) process.exit(1)"],{env:clean});
  for(const name of ['@getforma/core','@getforma/compiler','@getforma/build','@getforma/create-app']) {
    publishNpmPackage({...router,name},'/actual/archive.tgz',environment,TOKEN,(command,args,cwd,options)=>{
      assert.equal(command,'npm');assert.deepEqual(args,['publish','/actual/archive.tgz','--ignore-scripts','--provenance','--access','public','--tag','next']);
      assert(!Object.hasOwn(options.env,'NODE_AUTH_TOKEN'));assert(!Object.hasOwn(options.env,'NPM_ROUTER_BOOTSTRAP_TOKEN'));
    });
  }
  publishNpmPackage(router,'/actual/router.tgz',environment,undefined,(_c,_a,_w,options)=>assert(!Object.hasOwn(options.env,'NODE_AUTH_TOKEN')));
});
test('only first router child receives token via private reference file; cleanup runs after success or failure', () => {
  for(const fails of [false,true]) {
    let config;
    const invoke=()=>publishNpmPackage(router,'/actual/router.tgz',environment,TOKEN,(command,args,cwd,options)=>{
      assert.equal(command,'npm');assert(args.includes('--provenance'));assert.equal(args.at(-1),'next');
      assert.equal(options.env.NODE_AUTH_TOKEN,TOKEN);assert(!Object.hasOwn(options.env,'NPM_ROUTER_BOOTSTRAP_TOKEN'));
      config=options.env.NPM_CONFIG_USERCONFIG;
      const text=readFileSync(config,'utf8');assert(text.includes('${NODE_AUTH_TOKEN}'));assert(!text.includes(TOKEN));
      if(process.platform!=='win32')assert.equal(statSync(config).mode&0o777,0o600);
      execFileSync(process.execPath,['-e',"if (!process.env.NODE_AUTH_TOKEN || 'NPM_ROUTER_BOOTSTRAP_TOKEN' in process.env) process.exit(1)"],{env:options.env});
      if(fails)throw Error('simulated publish failure');
    });
    if(fails)assert.throws(invoke,/simulated publish/);else invoke();
    assert(config&&!existsSync(config));
  }
  assert.throws(()=>publishNpmPackage({...router,version:'3.2.0-rc.2'},'/x',environment,TOKEN,()=>assert.fail('must not publish')),/version differs/);
  assert.throws(()=>publishNpmPackage({...router,registry:'crates'},'/x',environment,TOKEN,()=>assert.fail('must not publish')),/registry differs/);
});
test('temporary credential is exposed only at the exact first tag publish step after DS11 verification', () => {
  const workflow=parse(readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8'));
  const job=workflow.jobs['publish-npm'], steps=job.steps;
  assert.equal(job.environment,'npm-publish');assert.equal(job.permissions['id-token'],'write');
  const index=steps.findIndex(step=>step.run?.includes('release-publish.mjs'));
  assert(index>steps.findIndex(step=>step.run?.includes('release-artifacts.sh verify')));
  assert.equal(steps[index].env.NPM_ROUTER_BOOTSTRAP_TOKEN,"${{ github.ref == 'refs/tags/v3.2.0-rc.1' && secrets.NPM_ROUTER_BOOTSTRAP_TOKEN || '' }}");
  for(const [name,other] of Object.entries(workflow.jobs)) {
    assert(!other.env?.NPM_ROUTER_BOOTSTRAP_TOKEN);
    for(const step of other.steps??[])if(!(name==='publish-npm'&&step===steps[index]))assert(!step.env?.NPM_ROUTER_BOOTSTRAP_TOKEN);
  }
});

test('workflow lint rejects broader credential scope, missing guard and direct NODE_AUTH_TOKEN injection', () => {
  const source=parse(readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8'));
  if(Object.hasOwn(source,'true')) {source.on=source.true;delete source.true;}
  const mutations=[
    doc=>{delete doc.jobs['publish-npm'].steps.at(-1).env;},
    doc=>{doc.jobs['publish-npm'].steps.at(-1).env.NPM_ROUTER_BOOTSTRAP_TOKEN='${{ secrets.NPM_ROUTER_BOOTSTRAP_TOKEN }}';},
    doc=>{doc.env={NPM_ROUTER_BOOTSTRAP_TOKEN:'${{ secrets.NPM_ROUTER_BOOTSTRAP_TOKEN }}'};},
    doc=>{doc.jobs.check.env={NODE_AUTH_TOKEN:'${{ secrets.NPM_ROUTER_BOOTSTRAP_TOKEN }}'};},
    doc=>{doc.jobs['publish-npm'].steps[0].env={OTHER:'${{ secrets.NPM_ROUTER_BOOTSTRAP_TOKEN }}'};},
  ];
  const root=mkdtempSync(join(tmpdir(),'router-publish-lint-'));
  try {
    mkdirSync(join(root,'.github/workflows'),{recursive:true});mkdirSync(join(root,'scripts'));
    writeFileSync(join(root,'scripts/release-contracts.json'),readFileSync(new URL('./release-contracts.json',import.meta.url)));
    for(const mutate of [()=>{},...mutations]) {
      const doc=structuredClone(source);mutate(doc);writeFileSync(join(root,'.github/workflows/release.yml'),JSON.stringify(doc));
      const result=spawnSync('ruby',[fileURLToPath(new URL('./check-release-workflow.rb',import.meta.url))],{cwd:root,encoding:'utf8'});
      if(mutations.includes(mutate)){assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/B10/);}
      else assert.equal(result.status,0,result.stdout+result.stderr);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
