// One diagnostic-only observation. This cannot create release acceptance.
import assert from 'node:assert/strict';
import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {measurePackedDecoder,validateDecoder,validateDecoderCorrectnessForDiagnostic} from './release-performance-decoder.mjs';
import {summarizeTiming,validateTimingControls} from './decoder-timing-diagnostic.mjs';
const [projectArg,outputArg]=process.argv.slice(2);assert(projectArg&&outputArg&&process.argv.length===4);
const project=resolve(projectArg),output=resolve(outputArg);mkdirSync(output);
const save=(file,value,flag='wx')=>{const fd=openSync(join(output,file),flag);try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
save('provenance.json',{diagnosticOnly:true,releaseAcceptance:false,originalProductSource:process.env.ORIGINAL_SOURCE,originalRun:'39016966304',originalArtifact:'12094879342',diagnosticHarness:source});
save('observations.jsonl',{kind:'start',diagnosticOnly:true});
let report;
try{
 report=await measurePackedDecoder({corePath:join(project,'node_modules/@getforma/core'),compilerPath:join(project,'node_modules/@getforma/compiler'),diagnosticTiming:true,onSample:sample=>save('observations.jsonl',{kind:'observation',...sample},'a')});
 save('report.json',report);
 let originalValidator;
 try{validateDecoder(report);originalValidator={passed:true};}
 catch(error){originalValidator={passed:false,error:String(error?.stack??error)};}
 save('original-validator-verdict.json',{diagnosticOnly:true,releaseAcceptance:false,...originalValidator});
 // The original validator stops at its first failure. An expected timing
 // refusal cannot hide a later bad value, browser error, or refusal control.
 validateDecoderCorrectnessForDiagnostic(report);
 save('diagnostic-correctness.json',{diagnosticOnly:true,releaseAcceptance:false,passed:true});
 const observations=report.cases.map(row=>({id:row.id,originalSummary:row.summary,warmups:row.warmups.map(s=>({run:s.run,...summarizeTiming(s.timing,s.elapsedMs)})),samples:row.samples.map(s=>({run:s.run,...summarizeTiming(s.timing,s.elapsedMs)}))}));
 const refusals=report.controls.map(c=>({id:c.id,...summarizeTiming(c.observation.timing,c.observation.elapsedMs)}));
 const controls=validateTimingControls(report.diagnosticTimingControls);
 save('analysis.json',{diagnosticOnly:true,releaseAcceptance:false,originalValidator,observations,refusals,controls,note:'Long-task phase intersections are wall-time overlap, not CPU attribution. Post-entry validation/hash work is separately timestamped. No original P17 sample is replaced.'});
 if(!originalValidator.passed&&!/decoder (?:ascii-string|string-array-20000) sample \d+: exceeds 30ms/.test(originalValidator.error))throw new Error(originalValidator.error);
 console.log(JSON.stringify({diagnosticCollectionComplete:true,releaseAcceptance:false,originalValidator,shapeSummaries:report.cases.map(c=>({id:c.id,...c.summary})),controls:report.diagnosticTimingControls}));
}catch(error){
 try{save('failure.json',{diagnosticOnly:true,error:String(error?.stack??error)});}
 catch(retentionError){console.error('Diagnostic failure retention also failed:',retentionError);}
 throw error;
}
