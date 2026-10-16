// FORMA-103: the shipped public activation path, with registration outside
// timing. This replaces the old private-preflight microbenchmark for DS12;
// it does not rewrite its archived results or interpret them as public timing.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {arch,cpus,platform,release,totalmem} from 'node:os';

const sha = value => createHash('sha256').update(value).digest('hex');
const LIMIT = 1_048_576;
export const DECODER_PROFILE = Object.freeze({
  browser: 'chromium', cpuSlowdown: 4, warmupsPerShape: 5, samplesPerShape: 40,
  stateBytes: LIMIT, maxSampleMs: 12, freshDocumentPerSample: true,
  start: 'immediately before packed activateIslands(registry)',
  end: 'first instruction of the registered component',
  registration: 'before start', validation: 'after end', retries: 0,
});
export const DECODER_CSP = "default-src 'none'; script-src 'self'; require-trusted-types-for 'script'; trusted-types forma; base-uri 'none'";

// Real generateRealIr output for these exact original sources. Frozen compiler
// artifact SHA256: 97af4f9a3352c12e82b6fae2342999b32402fa96605fa189f927b621aa2afd84.
// The browser component is instrumented only at entry; its returned div is the
// compiled fixture's unchanged tree. No native-render timing is claimed here.
export const DECODER_FIXTURES = Object.freeze([
  {id:'ascii-string', type:'string', h:'0b6bd4888368044a',
    sourceSha256:'95bfbc2e2499ae8efe3c5aea490de06da2b4d212f07e84edfb2dcc98409d1b25',
    irSha256:'6f0a02acaa8daaa3705d3ea0a98290c920a3857d5e96e5181960dba4f2a88250',
    schema:[[{name:'value',type:{kind:'string'}}]]},
  {id:'string-array-20000', type:'string[]', h:'58d120d39f55cfca',
    sourceSha256:'ec2d16eeaabdd9acd1ef26dc31489c538d0574776a015f8fe4110ad893218c9e',
    irSha256:'1b12c8dcd34ba1bcb52c54c71cf0c8b0dc10b418908e5449223839c0b11d8c40',
    schema:[[{name:'value',type:{kind:'array',element:{kind:'string'}}}]]},
]);
export function decoderSource(type) {
  return `import {h,mount,activateIslands} from '@getforma/core';\nexport function Decoder(p:{value:${type}}){return h('div',null);}\nexport function Page(p:{value:${type}}){return h('main',null,Decoder(p));}\nactivateIslands({Decoder});mount(Page,'#app');\n`;
}
export function decoderPayload(fixture) {
  const envelope = value => JSON.stringify({v:1,s:[],i:[{h:fixture.h,p:{value}}]});
  let value;
  if(fixture.id === 'ascii-string') value = 'x'.repeat(LIMIT - Buffer.byteLength(envelope('')));
  else {
    value = Array.from({length:20_000},()=> 'x'.repeat(48));
    value[value.length-1] += 'x'.repeat(LIMIT - Buffer.byteLength(envelope(value)));
  }
  const text = envelope(value);
  assert.equal(Buffer.byteLength(text),LIMIT); assert(!text.includes('<'));
  return {text,value,bytes:LIMIT,sha256:sha(text),valueSha256:sha(JSON.stringify(value))};
}
const sortedSummary = samples => {
  const values = samples.map(s=>s.elapsedMs).sort((a,b)=>a-b);
  return {minMs:values[0],medianMs:(values[19]+values[20])/2,p95Ms:values[37],maxMs:values[39]};
};
function checkObservation(observation,payload,negative=false) {
  assert.deepEqual(observation.pageErrors,[],'decoder: uncaught browser error');
  assert.deepEqual(observation.consoleErrors,observation.browserConsoleErrors,'decoder: uncaptured browser console error');
  assert.deepEqual(observation.policyViolations,[],'decoder: Trusted Types/CSP violation');
  assert.equal(observation.mutations,0,'decoder: activation wrote the initial DOM');
  assert.equal(observation.hostStatus,'pending','decoder: activation changed the host status');
  assert.equal(observation.stateBlocks,1);
  assert.equal(observation.calls,negative?0:1,'decoder: incorrect component entry count');
  if(negative) {
    assert.equal(observation.elapsedMs,null,'decoder: a refused input reached the component');
    assert.equal(observation.valueSha256,null);
    assert.equal(observation.consoleErrors.length,1);
    assert.match(observation.consoleErrors[0],/^\[forma\] FORMA_E_ISLAND_STATE:/);
  } else {
    assert.deepEqual(observation.consoleErrors,[],'decoder: activation reported an error');
    assert(Number.isFinite(observation.elapsedMs)&&observation.elapsedMs>0,'decoder: missing measured duration');
    assert.equal(observation.valueSha256,payload.valueSha256,'decoder: projected value differs');
    assert.equal(observation.valueLength,payload.value.length);
  }
}
export function validateDecoder(report) {
  assert.equal(report?.schema,1); assert.equal(report.pilot,false,'decoder: a pilot cannot qualify a release');
  assert.deepEqual(report.profile,DECODER_PROFILE,'decoder: actual measurement profile differs');
  assert.equal(report.responsePolicy,DECODER_CSP,'decoder: actual enforced Trusted Types header differs');
  assert(typeof report.browserVersion==='string'&&report.browserVersion.length>0);
  assert.equal(new Date(report.recordedAt).toISOString(),report.recordedAt,'decoder: recording date absent');
  assert.equal(report.artifact?.file,'dist/forma.esm.js');
  assert(/^[a-f0-9]{64}$/.test(report.artifact.sha256));
  assert(Number.isSafeInteger(report.artifact.bytes)&&report.artifact.bytes>0);
  for(const key of ['node','platform','release','architecture','cpu']) assert(typeof report.machine?.[key]==='string'&&report.machine[key].length>0,`decoder: missing machine ${key}`);
  for(const key of ['logicalCpus','memoryBytes']) assert(Number.isSafeInteger(report.machine[key])&&report.machine[key]>0);
  assert.deepEqual(report.cases?.map(row=>row.id),DECODER_FIXTURES.map(f=>f.id));
  for(const [index,row] of report.cases.entries()) {
    const fixture=DECODER_FIXTURES[index],payload=decoderPayload(fixture);
    assert.equal(sha(decoderSource(fixture.type)),fixture.sourceSha256);
    assert.deepEqual(row.registration,{h:fixture.h,mode:0,schema:fixture.schema});
    assert.equal(row.sourceSha256,fixture.sourceSha256); assert.equal(row.irSha256,fixture.irSha256);
    assert.equal(row.payloadBytes,LIMIT); assert.equal(row.payloadSha256,payload.sha256);
    assert.equal(row.warmups?.length,5,'decoder: require five warmups per shape');
    assert.equal(row.samples?.length,40,'decoder: require forty raw samples per shape');
    for(const [phase,observations] of [['warmup',row.warmups],['sample',row.samples]]) {
      for(const [i,observation] of observations.entries()) {
        assert.equal(observation.run,i+1,`decoder: duplicate/missing ${phase} run`);
        checkObservation(observation,payload);
        if(phase==='sample') assert(observation.elapsedMs<=12,`decoder ${row.id} sample ${i+1}: exceeds 12ms`);
      }
    }
    assert.deepEqual(row.summary,sortedSummary(row.samples),'decoder: summary differs from raw samples');
  }
  assert.deepEqual(report.controls?.map(c=>c.id),['oversize-one-byte','malformed-json']);
  const first=decoderPayload(DECODER_FIXTURES[0]);
  const texts=[first.text+' ',first.text.slice(0,-1)];
  for(const [index,control] of report.controls.entries()) {
    assert.equal(control.payloadBytes,Buffer.byteLength(texts[index]));
    assert.equal(control.payloadSha256,sha(texts[index]));
    checkObservation(control.observation,first,true);
  }
  return report;
}

// Return every observation even when its duration exceeds the budget. The
// caller must persist the result before validateDecoder enforces acceptance.
// onSample additionally lets the release owner preserve an interrupted attempt.
export async function measurePackedDecoder({corePath,onSample=()=>{}}) {
  const artifact=readFileSync(join(corePath,'dist/forma.esm.js'));
  const specs=DECODER_FIXTURES.map(fixture=>({...fixture,...decoderPayload(fixture)}));
  const documents=specs.map(spec=>({spec,text:spec.text}));
  documents.push({spec:specs[0],text:specs[0].text+' '},{spec:specs[0],text:specs[0].text.slice(0,-1)});
  const boot = `import {__islandRegistration,activateIslands,h} from '/core.mjs';
    window.runDecoder = async (metadata) => {
      const errors=[],violations=[];
      const originalError=console.error;
      console.error=(...args)=>{errors.push(args.map(String).join(' '));originalError(...args)};
      document.addEventListener('securitypolicyviolation',e=>violations.push(e.violatedDirective));
      let calls=0,elapsedMs=null,observed=null,begin;
      const Decoder=__islandRegistration(props=>{
        const entered=performance.now();
        elapsedMs=entered-begin;calls++;observed=props.value;
        return h('div',null);
      },metadata);
      const observer=new MutationObserver(()=>{});
      observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
      const registry={Decoder};
      begin=performance.now();activateIslands(registry);
      const mutations=observer.takeRecords().length;observer.disconnect();
      let valueSha256=null;
      if(calls) {
        const bytes=new TextEncoder().encode(JSON.stringify(observed));
        valueSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      }
      await new Promise(resolve=>setTimeout(resolve,0));
      return {elapsedMs,calls,valueSha256,valueLength:observed?.length??null,mutations,
        hostStatus:document.querySelector('[data-forma-island]').getAttribute('data-forma-status'),
        stateBlocks:document.querySelectorAll('head script[data-island-state]').length,
        consoleErrors:errors,policyViolations:violations};
    };`;
  const server=createServer((request,response)=>{
    response.setHeader('Cache-Control','no-store');
    const path=new URL(request.url,'http://localhost').pathname;
    if(path==='/favicon.ico'){response.writeHead(204);response.end();return;}
    if(path==='/core.mjs'||path==='/boot.mjs') {
      response.setHeader('Content-Type','text/javascript');response.end(path==='/core.mjs'?artifact:boot);return;
    }
    const document=documents[Number(path.slice(1))];
    if(!document||!/^\/\d+$/.test(path)){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy',DECODER_CSP);
    response.end(`<!doctype html><html><head><meta charset="utf-8"><script type="application/json" data-island-state>${document.text}</script><script type="module" src="/boot.mjs"></script></head><body><main><div data-forma-island="0" data-forma-state="0" data-forma-component="Decoder" data-forma-h="${document.spec.h}" data-forma-status="pending"></div></main></body></html>`);
  });
  let browser;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  try {
    const {chromium}=await import('@playwright/test');
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    page.setDefaultTimeout(30_000);
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const cpu=cpus();
    const report={schema:1,pilot:false,profile:{...DECODER_PROFILE},recordedAt:new Date().toISOString(),
      browserVersion:browser.version(),responsePolicy:null,
      artifact:{file:'dist/forma.esm.js',sha256:sha(artifact),bytes:artifact.length},
      machine:{node:process.version,platform:platform(),release:release(),architecture:arch(),cpu:cpu[0]?.model,logicalCpus:cpu.length,memoryBytes:totalmem()},cases:[],controls:[]};
    const errors=[],consoleErrors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    async function observe(index) {
      errors.length=0;consoleErrors.length=0;
      const response=await page.goto(`http://127.0.0.1:${server.address().port}/${index}`);
      assert.equal(response.status(),200);
      const policy=response.headers()['content-security-policy'];
      assert.equal(policy,DECODER_CSP);report.responsePolicy=policy;
      await page.waitForFunction(()=>typeof window.runDecoder==='function');
      const fixture=documents[index].spec;
      const observation=await page.evaluate(metadata=>window.runDecoder(metadata),{h:fixture.h,mode:0,schema:fixture.schema});
      return {...observation,pageErrors:[...errors],browserConsoleErrors:[...consoleErrors]};
    }
    for(const [index,spec] of specs.entries()) {
      const row={id:spec.id,registration:{h:spec.h,mode:0,schema:spec.schema},sourceSha256:spec.sourceSha256,irSha256:spec.irSha256,
        payloadBytes:spec.bytes,payloadSha256:spec.sha256,warmups:[],samples:[]};
      report.cases.push(row);
      for(const phase of ['warmup','sample']) for(let i=0;i<(phase==='warmup'?5:40);i++) {
        const observation={run:i+1,...await observe(index)};
        (phase==='warmup'?row.warmups:row.samples).push(observation);
        await onSample({id:spec.id,phase,observation});
      }
      row.summary=sortedSummary(row.samples);
    }
    for(const [index,id] of ['oversize-one-byte','malformed-json'].entries()) {
      const text=documents[index+2].text;
      const control={id,payloadBytes:Buffer.byteLength(text),payloadSha256:sha(text),observation:await observe(index+2)};
      report.controls.push(control);await onSample({id,phase:'control',observation:control.observation});
    }
    return report;
  } finally {
    try {if(browser)await browser.close();} finally {await new Promise(resolve=>server.close(resolve));}
  }
}
