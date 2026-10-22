import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedStatus } from './published-scaffold.mjs';

function controls() {
  const delays = [], warnings = [];
  return { delays, warnings, options: {
    sleep: async ms => { delays.push(ms); },
    warn: (...args) => { warnings.push(args); },
  }};
}
function metadataFor(url) {
  const parsed = new URL(url), parts = parsed.pathname.split('/'), version = parts.at(-1);
  if (parsed.hostname === 'registry.npmjs.org') {
    const name = decodeURIComponent(parts[1]);
    return {name, version, dist:{integrity:`sha512-${'a'.repeat(86)}==`, tarball:`https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`}};
  }
  return {version:{num:version, yanked:false, checksum:'a'.repeat(64)}};
}
const ok = url => ({status:200, ok:true, json:async()=>metadataFor(url)});

test('unpublished development sources never disable the separate candidate lane or query registry aliases', async()=>{
  const result=await publishedStatus('3.0.0-dev',()=>{throw Error('must not query a development version');});
  assert.equal(result.ready,false);assert.equal(result.version,'3.0.0-dev');assert.equal(result.packages.length,0);
});
test('registry preflight reports 404 as missing without retrying any of the seven identities',async()=>{
  let calls=0;
  const clock=controls();
  const result=await publishedStatus('3.0.0-alpha.1',async()=>{calls++;return{status:404};},clock.options);
  assert.equal(calls,7);assert.equal(result.missing.length,7);assert.equal(result.ready,false);
  assert.deepEqual(clock.delays,[]);assert.deepEqual(clock.warnings,[]);
});
test('a healthy lookup requires all seven exact published identities',async()=>{
  const urls=[];
  const result=await publishedStatus('3.0.0',async(url,options)=>{
    urls.push(url);assert(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);return ok(url);
  });
  assert.equal(result.ready,true);assert.equal(result.packages.length,7);assert.equal(new Set(urls).size,7);
  assert.deepEqual(result.packages.map(p=>p.name),['@getforma/core','@getforma/compiler','@getforma/build','@getforma/create-app','forma-ir','forma-ir-derive','forma-server']);
});
for (const status of [429,502,503,504]) test(`registry HTTP ${status} retries once and preserves the failure warning`,async()=>{
  let calls=0;
  const clock=controls();
  const result=await publishedStatus('3.0.0',async url=>++calls===1?{status,ok:false}:ok(url),clock.options);
  assert.equal(result.ready,true);assert.equal(calls,8);assert.deepEqual(clock.delays,[1000]);
  assert.equal(clock.warnings.length,1);assert.match(clock.warnings[0][0],/shared retry 1\/2/);
  assert.match(clock.warnings[0][1].message,new RegExp(String(status)));
});
for (const code of ['ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']) {
  test(`registry fetch ${code} retries the identified transient cause`,async()=>{
    let calls=0;
    const failure=new TypeError('fetch failed',{cause:Object.assign(Error('network failure'),{code})});
    const clock=controls();
    const result=await publishedStatus('3.0.0',async url=>{if(++calls===1)throw failure;return ok(url);},clock.options);
    assert.equal(result.ready,true);assert.equal(calls,8);assert.deepEqual(clock.delays,[1000]);
    assert.equal(clock.warnings[0][1],failure);
  });
}
test('a timeout while reading the response body retries the whole record',async()=>{
  let calls=0;
  const clock=controls(), failure=new DOMException('request timed out','TimeoutError');
  const result=await publishedStatus('3.0.0',async url=>++calls===1?{status:200,ok:true,json:async()=>{throw failure;}}:ok(url),clock.options);
  assert.equal(result.ready,true);assert.equal(calls,8);assert.deepEqual(clock.delays,[1000]);assert.equal(clock.warnings[0][1],failure);
});
test('two retries are shared across records rather than resetting for each package',async()=>{
  let calls=0;
  const clock=controls();
  await assert.rejects(()=>publishedStatus('3.0.0',async url=>++calls%2?{status:503,ok:false}:ok(url),clock.options),/@getforma\/build: registry readiness unreadable \(503\)/);
  assert.equal(calls,5);assert.deepEqual(clock.delays,[1000,2000]);assert.equal(clock.warnings.length,2);
});
test('persistent unavailability fails closed after three total attempts on the same record',async()=>{
  let calls=0;
  const clock=controls();
  await assert.rejects(()=>publishedStatus('3.0.0',async()=>{calls++;return{status:503,ok:false};},clock.options),/unreadable \(503\)/);
  assert.equal(calls,3);assert.deepEqual(clock.delays,[1000,2000]);assert.equal(clock.warnings.length,2);
});
for (const status of [400,401,403,500]) test(`registry HTTP ${status} fails immediately without a retry`,async()=>{
  let calls=0;
  const clock=controls();
  await assert.rejects(()=>publishedStatus('3.0.0',async()=>{calls++;return{status,ok:false};},clock.options),new RegExp(`unreadable \\(${status}\\)`));
  assert.equal(calls,1);assert.deepEqual(clock.delays,[]);assert.deepEqual(clock.warnings,[]);
});
for (const [label,failure] of [
  ['generic fetch TypeError',new TypeError('fetch failed')],
  ['explicit abort',new DOMException('aborted','AbortError')],
  ['unknown DNS name',Object.assign(Error('host not found'),{code:'ENOTFOUND'})],
  ['malformed JSON',new SyntaxError('Unexpected token in JSON')],
]) test(`${label} is not retried`,async()=>{
  let calls=0;
  const clock=controls();
  await assert.rejects(()=>publishedStatus('3.0.0',async()=>{calls++;return{status:200,ok:true,json:async()=>{throw failure;}};},clock.options),error=>error===failure);
  assert.equal(calls,1);assert.deepEqual(clock.delays,[]);assert.deepEqual(clock.warnings,[]);
});
for (const [label,target,mutate] of [
  ['wrong npm name','npm',m=>{m.name='@getforma/other';}],
  ['wrong npm version','npm',m=>{m.version='2.0.0';}],
  ['missing npm integrity','npm',m=>{delete m.dist.integrity;}],
  ['wrong npm tarball','npm',m=>{m.dist.tarball='https://example.com/other.tgz';}],
  ['invalid metadata schema','npm',m=>{delete m.dist;}],
  ['wrong crate version','crates',m=>{m.version.num='2.0.0';}],
  ['yanked crate','crates',m=>{m.version.yanked=true;}],
  ['invalid crate checksum','crates',m=>{m.version.checksum='bad';}],
]) test(`${label} fails validation without retrying`,async()=>{
  let calls=0;
  const clock=controls();
  await assert.rejects(()=>publishedStatus('3.0.0',async url=>{
    calls++;const metadata=metadataFor(url);
    if((new URL(url).hostname==='registry.npmjs.org')===(target==='npm'))mutate(metadata);
    return{status:200,ok:true,json:async()=>metadata};
  },clock.options));
  assert.equal(calls,target==='npm'?1:5);assert.deepEqual(clock.delays,[]);assert.deepEqual(clock.warnings,[]);
});

test('HTTP failure bodies are cancelled before another request or final rejection',async()=>{
  const events=[], clock=controls();
  await assert.rejects(()=>publishedStatus('3.0.0',async()=>{
    events.push('request');
    return{status:503,ok:false,body:{cancel:async()=>{events.push('cancel');}}};
  },clock.options),/unreadable \(503\)/);
  assert.deepEqual(events,['request','cancel','request','cancel','request','cancel']);
  assert.deepEqual(clock.delays,[1000,2000]);
});
test('body cleanup errors stay visible without replacing the registry failure or granting extra retries',async()=>{
  let calls=0;
  const cleanupFailure=Error('cleanup failed'), clock=controls();
  await assert.rejects(()=>publishedStatus('3.0.0',async()=>{
    calls++;return{status:503,ok:false,body:{cancel:async()=>{throw cleanupFailure;}}};
  },clock.options),/unreadable \(503\)/);
  assert.equal(calls,3);assert.deepEqual(clock.delays,[1000,2000]);
  assert.equal(clock.warnings.filter(([,error])=>error===cleanupFailure).length,3);
});
