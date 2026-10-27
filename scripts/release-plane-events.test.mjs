import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {REPOSITORY,NPM_PACKAGES,LEGACY_NPM_PACKAGES,ROUTER_NPM_PACKAGES,classifyEvent,signedWebhook,environmentSnapshot,settingsAlerts,registrySnapshot,registryAlerts} from './release-plane-events.mjs';
const base={repository:{full_name:REPOSITORY},sender:{login:'operator'}};
test('the configured five-package target retains the exact historical four-package reader',()=>{
 const actual=['core','compiler','build','create-app','router'].map(dir=>JSON.parse(readFileSync(new URL(`../packages/${dir}/package.json`,import.meta.url),'utf8')).name);
 assert.deepEqual([...NPM_PACKAGES].sort(),actual.sort());
 assert.deepEqual(NPM_PACKAGES,ROUTER_NPM_PACKAGES);
 assert.deepEqual(LEGACY_NPM_PACKAGES,['@getforma/core','@getforma/compiler','@getforma/build','@getforma/create-app']);
});
test('explicit router observation expands a historical baseline once without dropping existing history',()=>{
 const docs=Object.fromEntries(ROUTER_NPM_PACKAGES.map(name=>[name,{name,versions:{'3.2.0-rc.1':{name,version:'3.2.0-rc.1',dist:{integrity:'sha512-test-only'}}}}]));
 const legacyDocs=Object.fromEntries(Object.entries(docs).filter(([name])=>name!=='@getforma/router'));
 const prior=registrySnapshot(legacyDocs,LEGACY_NPM_PACKAGES);
 assert.throws(()=>registrySnapshot(legacyDocs),/selected npm observation/);
 const current=registrySnapshot(docs),alerts=registryAlerts(prior,current);
 assert.deepEqual(alerts.map(row=>row.kind),['npm-inventory-expanded','npm-registry-changed']);
 assert.equal(alerts[1].details.package,'@getforma/router');assert.equal(alerts[1].details.before,null);
 assert.deepEqual(registryAlerts(current,current),[]);
 assert.throws(()=>registryAlerts(current,prior),/cannot shrink/);
 delete docs['@getforma/router'];assert.throws(()=>registrySnapshot(docs,ROUTER_NPM_PACKAGES),/selected npm observation/);
 assert.throws(()=>registrySnapshot(docs,['@getforma/core']),/complete published/);
});
test('five seeded release-plane changes produce their specific alert',()=>{
 const tag=classifyEvent('create',{...base,ref_type:'tag',ref:'v3.0.0-beta.1'},{delivery:'tag-1'});
 const workflow=classifyEvent('push',{...base,ref:'refs/heads/main'},{delivery:'push-1',changedPaths:['.github/workflows/copied-release.yml']});
 const code=classifyEvent('push',{...base,ref:'refs/heads/main'},{delivery:'push-2',changedPaths:['crates/forma-server/src/csp.rs']});
 const rule=classifyEvent('repository_ruleset',{...base,action:'edited',repository_ruleset:{id:25048046}},{delivery:'rule-1'});
 const old=environmentSnapshot([{name:'npm-publish',can_admins_bypass:true,protection_rules:[],deployment_branch_policy:null,branchPolicies:[]}]);
 const current=structuredClone(old);current.environments[0].can_admins_bypass=false;
 const environment=settingsAlerts(old,current);
 assert.deepEqual([tag[0].kind,workflow[0].kind,code[0].kind,rule[0].kind,environment[0].kind],['tag-created','workflow-changed','code-owned-push','ruleset-changed','environment-changed']);
 assert.equal(workflow.filter(row=>row.kind==='workflow-changed').length,1);
 assert.equal(code.length,1);assert.equal(rule.length,1);assert.equal(environment.length,1);
 assert([tag,workflow,code,rule,environment].flat().every(row=>row.delivered===false));
 assert.deepEqual(settingsAlerts(old,old),[]);
 assert.equal(settingsAlerts(null,old)[0].kind,'environment-baseline-established');
});
test('signed raw webhook rejects altered bytes, missing signatures and wrong repositories',()=>{
 const secret='test-only-'.repeat(4),body=Buffer.from(JSON.stringify({...base,ref_type:'tag',ref:'v3.0.0-beta.1'}));
 const request={secret,body,event:'create',delivery:'delivery-1',signature:'sha256='+createHmac('sha256',secret).update(body).digest('hex')};
 assert.equal(signedWebhook(request).length,1);
 for(const change of [{body:Buffer.concat([body,Buffer.from(' ')])},{signature:''},{secret:'short'}])assert.throws(()=>signedWebhook({...request,...change}));
 assert.throws(()=>classifyEvent('create',{...base,repository:{full_name:'another/repo'},ref_type:'tag'},{delivery:'delivery-2'}));
 assert.throws(()=>classifyEvent('push',{...base,ref:'refs/heads/main'},{delivery:'delivery-3'}));
 assert.throws(()=>environmentSnapshot([{name:'npm-publish',can_admins_bypass:true,protection_rules:[]}]));
});
test('outside-GitHub registry comparison requires every package and flags version integrity changes',()=>{
 const docs=Object.fromEntries(NPM_PACKAGES.map(name=>[name,{name,versions:{'3.0.0-alpha.2':{name,version:'3.0.0-alpha.2',dist:{integrity:'sha512-test-only'}}}}]));
 const before=registrySnapshot(docs);
 assert.deepEqual(registryAlerts(before,before),[]);assert.equal(registryAlerts(null,before)[0].kind,'npm-baseline-established');
 docs['@getforma/core'].versions['3.0.0-alpha.2'].dist.integrity='sha512-changed';
 assert.equal(registryAlerts(before,registrySnapshot(docs)).length,1);
 delete docs['@getforma/compiler'];assert.throws(()=>registrySnapshot(docs));
});

// Exercise the real CLI/default inventory with a closed provider. No request can
// escape this injected fetch; the caller's real baseline is never consulted.
test('default npm collector requests all five, preserves a historical baseline and refuses missing router',t=>{
 const dir=mkdtempSync(join(tmpdir(),'forma-monitor-inventory-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const docs=Object.fromEntries(NPM_PACKAGES.map(name=>{const version=name==='@getforma/router'?'3.2.0-rc.1':'3.1.0';return [name,{name,versions:{[version]:{name,version,dist:{integrity:'sha512-test-only'}}}}];}));
 const baseline=registrySnapshot(Object.fromEntries(Object.entries(docs).filter(([name])=>name!=='@getforma/router')),LEGACY_NPM_PACKAGES);
 const baselinePath=join(dir,'historical-baseline.json'),baselineBytes=JSON.stringify(baseline,null,2)+'\n';writeFileSync(baselinePath,baselineBytes);
 const provider=join(dir,'provider.mjs');writeFileSync(provider,`
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(process.env.FORMA_TEST_PROVIDER,'utf8')),calls=[];
globalThis.fetch=async (inputURL,options)=>{
 const url=new URL(inputURL),name=decodeURIComponent(url.pathname.slice(1));
 assert.equal(url.origin,'https://registry.npmjs.org');assert(Object.hasOwn(input.docs,name),'unmocked package');
 assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{Accept:'application/json'});
 calls.push(name);writeFileSync(input.calls,JSON.stringify(calls));
 return input.missing===name?new Response('package missing',{status:404}):Response.json(input.docs[name]);
};
`);
 function collect(name,missing){
  const input=join(dir,name+'-input.json'),out=join(dir,name+'-report.json'),calls=join(dir,name+'-calls.json');
  writeFileSync(input,JSON.stringify({docs,missing,calls}));
  const env={...process.env,FORMA_TEST_PROVIDER:input};
  for(const key of ['GITHUB_ACTIONS','GH_TOKEN','GITHUB_TOKEN','NODE_AUTH_TOKEN','NPM_ROUTER_BOOTSTRAP_TOKEN','NODE_OPTIONS'])delete env[key];
  const child=spawnSync(process.execPath,['--import',pathToFileURL(provider).href,fileURLToPath(new URL('./release-plane-observe.mjs',import.meta.url)),'npm','--baseline',baselinePath,'--out',out],{env,encoding:'utf8',timeout:10000});
  assert.equal(child.error,undefined,child.error?.message);assert.equal(child.signal,null);
  const report=JSON.parse(readFileSync(out,'utf8'));
  assert.deepEqual(JSON.parse(readFileSync(calls,'utf8')),NPM_PACKAGES);
  assert.equal(readFileSync(baselinePath,'utf8'),baselineBytes,'collector must never promote or overwrite its input baseline');
  assert.equal(report.delivered,false);
  return {status:child.status,report,stderr:child.stderr};
 }
 const missing=collect('missing-router','@getforma/router');
 assert.equal(missing.status,1,missing.stderr);assert.equal(missing.report.complete,false);
 assert.match(missing.report.error,/@getforma\/router: HTTP 404/);
 assert.equal(Object.hasOwn(missing.report,'snapshot'),false);assert.equal(Object.hasOwn(missing.report,'alerts'),false);
 const complete=collect('complete');assert.equal(complete.status,0,complete.stderr);assert.equal(complete.report.complete,true);
 assert.deepEqual(Object.keys(complete.report.snapshot.packages).sort(),[...NPM_PACKAGES].sort());
 assert.deepEqual(complete.report.alerts.map(row=>row.kind),['npm-inventory-expanded','npm-registry-changed']);
 assert.equal(complete.report.alerts[1].details.package,'@getforma/router');
 assert.equal(complete.report.alerts[1].details.before,null);
 assert.deepEqual(registryAlerts(complete.report.snapshot,complete.report.snapshot),[]);
 assert.throws(()=>registryAlerts(complete.report.snapshot,baseline),/cannot shrink/);
});
