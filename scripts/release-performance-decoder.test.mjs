import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {DECODER_CSP,DECODER_PROFILE,DECODER_FIXTURES,decoderSource,decoderPayload,validateDecoder} from './release-performance-decoder.mjs';

import {decoder as valid} from './release-performance-test-fixtures.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('both finite payload shapes pin the complete UTF-8 envelope to exactly one MiB',()=>{
  for(const fixture of DECODER_FIXTURES) {
    const payload=decoderPayload(fixture);
    assert.equal(Buffer.byteLength(payload.text),1_048_576);assert(!payload.text.includes('<'));
    assert.equal(sha(payload.text),payload.sha256);assert.equal(sha(decoderSource(fixture.type)),fixture.sourceSha256);
    const decoded=JSON.parse(payload.text).i[0].p.value;
    assert.deepEqual(decoded,payload.value);
    if(fixture.id==='ascii-string')assert.match(decoded,/^x+$/);
    else {assert.equal(decoded.length,20_000);assert(decoded.every(value=>/^(?:é😀)+x*$/.test(value)));assert(Buffer.byteLength(payload.text)>payload.text.length);}
  }
});
test('the L-61 thirty-millisecond boundary is inclusive for every sample of both shapes',()=>{
  const boundary=valid();
  for(const row of boundary.cases){for(const sample of row.samples)sample.elapsedMs=30;row.summary={minMs:30,medianMs:30,p95Ms:30,maxMs:30};}
  assert.doesNotThrow(()=>validateDecoder(boundary));
  const historical=valid();historical.profile.maxSampleMs=12;
  assert.throws(()=>validateDecoder(historical),/actual measurement profile differs/);
  for(const index of [0,1]) {
    const report=valid();report.cases[index].samples[39].elapsedMs=30.0001;
    assert.throws(()=>validateDecoder(report),/sample 40: exceeds 30ms/);
  }
});
test('raw sample provenance cannot be replaced by claimed passing summaries',()=>{
  for(const mutate of [
    r=>{delete r.cases[0].samples;},r=>r.cases[1].samples.pop(),r=>r.cases[0].warmups.pop(),
    r=>{r.cases[1].samples[39].run=39;},r=>{r.cases[0].samples[1].elapsedMs=NaN;},
    r=>{r.cases[0].samples[1].elapsedMs=0;},r=>{r.cases[0].summary.p95Ms=1;},
    r=>{r.cases[0].payloadBytes--;},r=>{r.cases[1].payloadSha256='b'.repeat(64);},
    r=>{r.cases[1].samples[1].valueSha256='b'.repeat(64);},r=>{r.cases[1].samples[1].valueLength=19_999;},
  ]) {const report=valid();mutate(report);assert.throws(()=>validateDecoder(report));}
});
test('profile, public artifact, machine, actual CSP and compiler registration are mandatory',()=>{
  for(const mutate of [
    r=>{r.pilot=true;},r=>{r.profile.cpuSlowdown=1;},r=>{r.profile.start='private preflight';},
    r=>{r.profile.retries=1;},r=>{r.responsePolicy="script-src 'self'";},
    r=>{r.artifact.file='src/dom/island-state.ts';},r=>{r.artifact.sha256='';},
    r=>{delete r.compiler;},r=>{r.compiler.fixtures=[];},r=>{r.compiler.sha256='';},
    r=>{r.machine.cpu='';},r=>{r.machine.logicalCpus=0;},r=>{r.recordedAt='';},
    r=>{r.cases[0].registration={...r.cases[0].registration,h:'0'.repeat(16)};},
    r=>{r.cases[0].sourceSha256='c'.repeat(64);},r=>{r.cases[0].irSha256='c'.repeat(64);},
  ]) {const report=valid();mutate(report);assert.throws(()=>validateDecoder(report));}
});
test('real activation must enter once with no mutations, errors or policy violations',()=>{
  for(const mutate of [
    o=>{o.calls=0;},o=>{o.calls=2;},o=>{o.mutations=1;},o=>{o.hostStatus='error';},
    o=>{o.pageErrors=['uncaught'];},o=>{o.consoleErrors=['refused'];o.browserConsoleErrors=['refused'];},
    o=>{o.browserConsoleErrors=['uncaptured module failure'];},o=>{o.policyViolations=['require-trusted-types-for'];},
    o=>{o.stateBlocks=0;},
  ]) {const report=valid();mutate(report.cases[0].samples[0]);assert.throws(()=>validateDecoder(report));}
});
test('oversize and malformed controls need actual refusal observations before component entry',()=>{
  for(const mutate of [
    r=>{r.controls=[];},r=>{r.controls[0].payloadBytes--;},r=>{r.controls[1].payloadSha256='a'.repeat(64);},
    r=>{r.controls[0].observation.calls=1;},r=>{r.controls[0].observation.elapsedMs=1;},
    r=>{r.controls[0].observation.mutations=1;},r=>{r.controls[1].observation.consoleErrors=[];r.controls[1].observation.browserConsoleErrors=[];},
    r=>{r.controls[1].observation.consoleErrors=['different failure'];r.controls[1].observation.browserConsoleErrors=['different failure'];},
    r=>{const errors=['[forma] FORMA_E_ISLAND_STATE: missing first head state block'];r.controls[0].observation.consoleErrors=errors;r.controls[0].observation.browserConsoleErrors=errors;},
  ]) {const report=valid();mutate(report);assert.throws(()=>validateDecoder(report));}
});
