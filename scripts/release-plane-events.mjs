// SR26: pure detection and signed webhook ingestion. Returns an outbox;
// notification delivery is an external operator-owned adapter, never claimed here.
import assert from 'node:assert/strict';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

export const REPOSITORY='getforma-dev/forma';
export const LEGACY_NPM_PACKAGES=['@getforma/core','@getforma/compiler','@getforma/build','@getforma/create-app'];
export const ROUTER_NPM_PACKAGES=[...LEGACY_NPM_PACKAGES,'@getforma/router'];
// Configure the complete target inventory before the release audit freezes source.
// A missing package still fails observation; this does not claim live enrollment.
export const NPM_PACKAGES=[...ROUTER_NPM_PACKAGES];
export const ownedPath=path=>path.startsWith('.github/') || [
 'crates/forma-ir/src/walker.rs','crates/forma-ir/src/text.rs',
 'crates/forma-server/src/csp.rs','crates/forma-server/src/template.rs',
 'packages/core/src/security/url-safety.ts',
].includes(path) || path.startsWith('scripts/release-plane-') || path==='scripts/security-mutation-probes.py' || path.startsWith('docs/governance/');

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function event(id,kind,details){return {id,kind,repository:REPOSITORY,detective:true,delivered:false,details};}

export function classifyEvent(kind,payload,{delivery,changedPaths}={}) {
 assert.equal(payload.repository?.full_name,REPOSITORY,'unexpected repository');
 assert(typeof delivery==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(delivery),'invalid delivery identity');
 const sender=payload.sender?.login??'unknown';
 const emit=(type,details)=>event(`${delivery}:${type}`,type,{sender,...details});
 if(kind==='create') {
  assert(['tag','branch','repository'].includes(payload.ref_type),'invalid create event');
  return payload.ref_type==='tag'?[emit('tag-created',{tag:payload.ref})]:[];
 }
 if(kind==='repository_ruleset') {
  assert(['created','edited','deleted'].includes(payload.action),'invalid ruleset action');
  assert(Number.isSafeInteger(payload.repository_ruleset?.id),'missing ruleset identity');
  return [emit('ruleset-changed',{action:payload.action,ruleset:payload.repository_ruleset})];
 }
 assert.equal(kind,'push','unsupported event');
 assert(typeof payload.ref==='string');
 if(!['refs/heads/main','refs/heads/codex/forma-upgrade-review'].includes(payload.ref))return [];
 // GitHub's Actions push payload does not supply authoritative changed files.
 // The caller computes a complete local git diff of before..after. Do not trust
 // the capped commits array or interpret an unavailable diff as no change.
 assert(Array.isArray(changedPaths),'push detection requires a complete changed-file list');
 assert(changedPaths.every(path=>typeof path==='string'&&path&&!path.startsWith('/')&&!path.split('/').includes('..')),'invalid repository path');
 const workflow=changedPaths.filter(path=>path.startsWith('.github/workflows/'));
 const owned=changedPaths.filter(ownedPath);
 const details={ref:payload.ref,before:payload.before,after:payload.after};
 return [
  ...(workflow.length?[emit('workflow-changed',{...details,paths:[...new Set(workflow)].sort()})]:[]),
  ...(owned.length?[emit('code-owned-push',{...details,paths:[...new Set(owned)].sort()})]:[]),
 ];
}

export function signedWebhook({body,signature,event:kind,delivery,secret,changedPaths}) {
 assert(Buffer.isBuffer(body)&&body.length<=25*1024*1024,'webhook body exceeds GitHub limit');
 assert(typeof secret==='string'&&secret.length>=32,'configure a strong external webhook secret');
 assert(/^sha256=[a-f0-9]{64}$/.test(signature??''),'missing sha256 signature');
 const expected=createHmac('sha256',secret).update(body).digest();
 assert(timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')),'invalid webhook signature');
 return classifyEvent(kind,JSON.parse(body.toString('utf8')),{delivery,changedPaths});
}

export function environmentSnapshot(details) {
 assert(Array.isArray(details));
 const names=new Set();
 const environments=details.map(item=>{
  assert(typeof item.name==='string'&&item.name&&!names.has(item.name),'invalid or duplicate environment');names.add(item.name);
  assert(typeof item.can_admins_bypass==='boolean'&&Array.isArray(item.protection_rules),'incomplete environment settings');
  assert(Array.isArray(item.branchPolicies),'missing deployment branch policy pages');
  return {name:item.name,can_admins_bypass:item.can_admins_bypass,
   protection_rules:item.protection_rules.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
   deployment_branch_policy:item.deployment_branch_policy,
   branchPolicies:item.branchPolicies.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
 }).sort((a,b)=>a.name.localeCompare(b.name));
 return {schema:1,repository:REPOSITORY,environments};
}

export function settingsAlerts(previous,current) {
 assert.equal(current?.schema,1);assert.equal(current.repository,REPOSITORY);
 const checked=environmentSnapshot(current.environments);assert.deepEqual(current,checked);
 if(previous===null)return [event('environment-baseline:'+fingerprint(current),'environment-baseline-established',{snapshot:current})];
 assert.equal(previous?.schema,1);assert.equal(previous.repository,REPOSITORY);
 assert.deepEqual(previous,environmentSnapshot(previous.environments));
 return fingerprint(previous)===fingerprint(current)?[]:[event('environment-change:'+fingerprint(current),'environment-changed',{before:previous,after:current})];
}

function registryInventory(names) {
 const sorted=[...names].sort();
 assert.deepEqual(sorted,[...(names.includes('@getforma/router')?ROUTER_NPM_PACKAGES:LEGACY_NPM_PACKAGES)].sort(),'complete published npm observation required');
 return sorted;
}
export function registrySnapshot(packuments, inventory = NPM_PACKAGES) {
 const names=registryInventory(inventory);
 assert.deepEqual(Object.keys(packuments).sort(),names,'complete selected npm observation required');
 return {schema:1,repository:REPOSITORY,packages:Object.fromEntries(names.map(name=>{
  const doc=packuments[name];assert.equal(doc?.name,name);assert(doc.versions&&typeof doc.versions==='object'&&!Array.isArray(doc.versions));
  const versions=Object.entries(doc.versions).map(([version,manifest])=>{
   assert.equal(manifest.version,version);assert.equal(manifest.name,name);
   assert(typeof manifest.dist?.integrity==='string'&&manifest.dist.integrity,'npm version lacks integrity');
   return [version,{integrity:manifest.dist.integrity,deprecated:manifest.deprecated??null}];
  });
  assert(versions.length>0,'empty npm history');
  return [name,Object.fromEntries(versions.sort(([a],[b])=>a.localeCompare(b)))];
 }))};
}

export function registryAlerts(previous,current) {
 assert.equal(current?.schema,1);assert.equal(current.repository,REPOSITORY);
 const names=registryInventory(Object.keys(current.packages));
 if(previous===null)return [event('npm-baseline:'+fingerprint(current),'npm-baseline-established',{snapshot:current})];
 assert.equal(previous.schema,1);assert.equal(previous.repository,REPOSITORY);
 const before=registryInventory(Object.keys(previous.packages));
 assert(before.every(name=>names.includes(name)),'registry inventory cannot shrink');
 const expanded=names.length!==before.length;
 return [
  ...(expanded?[event('npm-inventory:'+fingerprint(names),'npm-inventory-expanded',{before,after:names})]:[]),
  ...names.flatMap(name=>Object.hasOwn(previous.packages,name)&&fingerprint(previous.packages[name])===fingerprint(current.packages[name])?[]:[event('npm-change:'+name+':'+fingerprint(current.packages[name]),'npm-registry-changed',{package:name,before:previous.packages[name]??null,after:current.packages[name]})]),
 ];
}
