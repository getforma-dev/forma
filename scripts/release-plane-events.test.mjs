import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {REPOSITORY,NPM_PACKAGES,classifyEvent,signedWebhook,environmentSnapshot,settingsAlerts,registrySnapshot,registryAlerts} from './release-plane-events.mjs';
const base={repository:{full_name:REPOSITORY},sender:{login:'operator'}};
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
