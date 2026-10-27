import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DECODER_CSP,DECODER_PROFILE,DECODER_32_PROFILE,DECODER_FIXTURES,decoderProfile,decoderSource,decoderPayload,validateDecoder} from './release-performance-decoder.mjs';

import {decoder as valid} from './release-performance-test-fixtures.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
// Exact historical binaries independently checked against the already-pinned
// full SHA-256 values below. These are validator inputs, never measurements.
const frozenIr = [
  'iUZNSQ0KGgoDAAAAAAAHAQAAK8oRcQAABgAAAAEAAQBkAAAAHgAAAAIAAQCCAAAAJwAAAAMAAQCpAAAADAAAAAQAAQC1AAAAHwAAAAUAAQDUAAAAKAAAAAoAAQD8AAAAIwAAAAEAAAAAAAALAAABAgAAAAAAAgIAAAAMAAACAAAAAAUAAAAEAG1haW4HAERlY29kZXIDAGRpdgUAdmFsdWUGAGFwcC50cwEAAAADAAAAAQAAAAEAGwAAAAEAAQAAAAcAAAABAAgLa9SIg2gESgEAAAACAAEAAwAAAAQAAAADAAAAGQAAAAIBAAMAAAAEAAAAAgAAABwAAAACAQAbAAAAAAAEAAAAAQAAAA0AAAABAQABAAUAdmFsdWUCAAA=',
  'iUZNSQ0KGgoDAAAAAAAKAQAAgcF6EwAABgAAAAEAAQBkAAAAHgAAAAIAAQCCAAAAJwAAAAMAAQCpAAAADAAAAAQAAQC1AAAAHwAAAAUAAQDUAAAAKgAAAAoAAQD+AAAAJAAAAAEAAAAAAAALAAABAgAAAAAAAgIAAAAMAAACAAAAAAUAAAAEAG1haW4HAERlY29kZXIDAGRpdgUAdmFsdWUGAGFwcC50cwEAAAADAAAABAAAAAEAGwAAAAEAAQAAAAcAAAABAAhY0SDTn1XPygEAAAACAAEAAwAAAAQAAAADAAAAGQAAAAYCAQADAAAABAAAAAIAAAAcAAAABgIBABwAAAAAAAQAAAABAAAADgAAAAEBAAEABQB2YWx1ZQYCAAA=',
];
function restamp(bytes) {
  const crc=Number(execFileSync('python3',['-c','import sys,zlib; b=sys.stdin.buffer.read(); print(zlib.crc32(b[:18]+b[22:]) & 0xffffffff)'],{input:bytes,encoding:'utf8'}));
  bytes.writeUInt32LE(crc,18); return bytes;
}
function currentProof(version='3.1.0-rc.1') {
  const report=valid(); report.compiler.version=version; report.artifact.version=version;
  report.compiler.fixtures.forEach((proof,index)=>{
    const bytes=Buffer.from(frozenIr[index],'base64');
    assert.equal(sha(bytes),DECODER_FIXTURES[index].irSha256);
    version.split('-')[0].split('.').map(Number).forEach((part,index)=>bytes.writeUInt16LE(part,8+2*index)); restamp(bytes);
    proof.binaryBase64=bytes.toString('base64'); proof.irSha256=sha(bytes);
    report.cases[index].irSha256=proof.irSha256;
  });
  return report;
}
test('current compiler proof retains actual versioned bytes and the unchanged historical full-binary contract',()=>{
  for(const version of ['3.0.0','3.1.0-rc.1']) {
    const report=currentProof(version); assert.equal(validateDecoder(report),report);
  }
  assert.equal(validateDecoder(valid()).compiler.version,undefined,'archived 3.0 evidence remains exact');
});
test('a repaired CRC or matching claimed digest cannot hide current decoder body/header drift',()=>{
  for(const [offset,message] of [[0,/signature/],[10,/writer does not match/],[14,/body length/],[22,/reserved header/],[286,/emitted bytes differ/]]) {
    const report=currentProof(),proof=report.compiler.fixtures[0];
    const bytes=Buffer.from(proof.binaryBase64,'base64'); bytes[offset]^=1; restamp(bytes);
    proof.binaryBase64=bytes.toString('base64'); proof.irSha256=sha(bytes); report.cases[0].irSha256=proof.irSha256;
    assert.throws(()=>validateDecoder(report),message);
  }
});
test('current decoder proof rejects absent bytes, stale hashes, mismatched package versions and a legacy downgrade',()=>{
  for(const mutate of [
    r=>{delete r.compiler.fixtures[0].binaryBase64;},
    r=>{r.compiler.fixtures[0].binaryBase64+='\n';},
    r=>{r.compiler.fixtures[0].irSha256='a'.repeat(64);},
    r=>{r.cases[0].irSha256=DECODER_FIXTURES[0].irSha256;},
    r=>{r.artifact.version='3.0.0';},r=>{delete r.compiler.version;},
    r=>{const p=r.compiler.fixtures[0],b=Buffer.from(p.binaryBase64,'base64');b[18]^=1;p.binaryBase64=b.toString('base64');p.irSha256=sha(b);r.cases[0].irSha256=p.irSha256;},
  ]) {const report=currentProof();mutate(report);assert.throws(()=>validateDecoder(report));}
});
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
function boundaryWithOutliers() {
  const report=valid();
  for(const row of report.cases) {
    for(const [i,sample] of row.samples.entries())sample.elapsedMs=i===0?90:i===39?45:30;
    row.summary={minMs:30,medianMs:30,p95Ms:30,maxMs:90};
  }
  return report;
}
test('nearest-rank p95 accepts the exact 30 ms boundary, retaining all forty durations and the maximum',()=>{
  const boundary=boundaryWithOutliers();
  assert.equal(validateDecoder(boundary),boundary);
  for(const row of boundary.cases) {
    assert.equal(row.samples.length,40);assert.equal(row.samples[0].elapsedMs,90);
    assert.equal(row.samples[39].elapsedMs,45);assert.equal(row.summary.maxMs,90);
  }
  for(const index of [0,1]) {
    const report=boundaryWithOutliers();report.cases[index].samples[20].elapsedMs=30.0001;
    report.cases[index].summary.p95Ms=30.0001;
    assert.throws(()=>validateDecoder(report),/p95: exceeds 30ms/);
  }
});
test('old every-sample policies and changed p95 identities cannot qualify',()=>{
  for(const limit of [12,30]) {
    const historical=valid();delete historical.profile.policy;delete historical.profile.statistic;
    delete historical.profile.maxP95Ms;historical.profile.maxSampleMs=limit;
    assert.throws(()=>validateDecoder(historical),/actual measurement profile differs/);
  }
  for(const mutate of [p=>{delete p.policy;},p=>{p.policy='public-decoder-p95-v0';},
    p=>{p.statistic='median';},p=>{p.maxP95Ms=30.0001;}]) {
    const report=valid();mutate(report.profile);
    assert.throws(()=>validateDecoder(report),/actual measurement profile differs/);
  }
});
test('3.2 explicitly accepts at most 30.7 ms without rewriting legacy profiles or other releases',()=>{
  for(const version of ['3.2.0-rc.4','3.2.0']) {
    const report=currentProof(version);
    report.profile={...decoderProfile(version)};
    assert.deepEqual(report.profile,DECODER_32_PROFILE);
    for(const row of report.cases) {
      for(const [index,sample] of row.samples.entries())sample.elapsedMs=index<2?90:30.7;
      row.summary={minMs:30.7,medianMs:30.7,p95Ms:30.7,maxMs:90};
    }
    assert.equal(validateDecoder(report),report);
    const historical=structuredClone(report);historical.profile={...DECODER_PROFILE};
    assert.throws(()=>validateDecoder(historical),/p95: exceeds 30ms/);
    const excessive=structuredClone(report);excessive.cases[1].samples[20].elapsedMs=30.7001;
    excessive.cases[1].summary.p95Ms=30.7001;
    assert.throws(()=>validateDecoder(excessive),/p95: exceeds 30.7ms/);
    const corrupt=structuredClone(report);corrupt.controls[1].observation.calls=1;
    assert.throws(()=>validateDecoder(corrupt),/incorrect component entry count/);
  }
  for(const version of ['3.0.0','3.1.0','3.2.1','3.3.0','3.2.0-beta.1','3.2.0-rc.0']) {
    assert.equal(decoderProfile(version),DECODER_PROFILE);
    const report=currentProof(version);report.profile={...DECODER_32_PROFILE};
    assert.throws(()=>validateDecoder(report),/actual measurement profile differs/);
  }
});
test('a passing p95 cannot hide later incorrect values, invalid durations or broken refusal controls',()=>{
  for(const mutate of [
    r=>{r.cases[1].samples[39].valueSha256='b'.repeat(64);},
    r=>{r.cases[1].samples[39].valueLength=19_999;},
    r=>{r.cases[1].samples[39].elapsedMs=NaN;},
    r=>{r.cases[1].samples[39].calls=0;},
    r=>{r.controls[1].observation.calls=1;},
  ]) {const report=boundaryWithOutliers();mutate(report);assert.throws(()=>validateDecoder(report));}
});
test('both shapes and refusal controls are validated before rejecting an excessive p95',()=>{
  for(const [mutate,message] of [
    [r=>{r.cases[1].samples[39].valueSha256='b'.repeat(64);},/projected value differs/],
    [r=>{r.controls[1].observation.calls=1;},/incorrect component entry count/],
  ]) {
    const report=boundaryWithOutliers();report.cases[0].samples[20].elapsedMs=30.0001;
    report.cases[0].summary.p95Ms=30.0001;mutate(report);
    assert.throws(()=>validateDecoder(report),message);
  }
});
test('raw sample provenance cannot be replaced by claimed passing summaries',()=>{
  for(const mutate of [
    r=>{delete r.cases[0].samples;},r=>r.cases[1].samples.pop(),r=>r.cases[0].warmups.pop(),
    r=>{r.cases[1].samples[39].run=39;},r=>{r.cases[0].samples[1].elapsedMs=NaN;},
    r=>{r.cases[0].samples[1].elapsedMs=0;},r=>{r.cases[0].summary.p95Ms=1;},
    r=>{r.cases[0].summary.minMs=1;},r=>{r.cases[0].summary.medianMs=1;},r=>{r.cases[0].summary.maxMs=1;},
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
