#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, config, readJSON, writeJSON, parseOptions, assertOptions, makePlan, preflight, sourceIdentity, environment, runPath, acquire, seal, verify, history, safePath } from './session.mjs';
import { generateReport, collectReport, compareRuns } from './report.mjs';
import { planCleanup, applyCleanup } from './cleanup.mjs';
import { checkUpdates, stageUpdate, applyUpdate } from './updates.mjs';

import { readLedger, renderChanges } from './lineage.mjs';
import { planRecovery, applyRecovery } from './recovery.mjs';
import { importEvidence } from './import-evidence.mjs';

const help=`Forma Grand Prix — a performance laboratory for improving Forma fairly

Run from benchmarks/grand-prix: npm run gp -- <command>

  catalog                         Suites, competitors and frozen/current versions
  doctor [--suite server]         Check prerequisites without installing anything
  plan [run options]              Show the exact run plan without executing it
  run [run options]               Fresh run, logs, report, integrity and pit cleanup
  history                         All retained managed runs, including failures
  changes                         Engineering changes, evidence and tradeoffs
  dashboard                       Generate the local human-readable laboratory home
  import-evidence <zip> --id <id> Import retained evidence without rerunning it
  report <run-id>                  Regenerate a verified run's readable report
  compare <baseline> <current>    Gate comparisons on protocol and campaign identity
  verify <run-id>                  Check retained evidence for changed/missing files
  recover <run-id> [--apply]       Recover a proven-dead local run; preserve its evidence
  cleanup <run-id> [--apply]      Preview cleanup (add --dependencies or --docker)
  updates                         Check current npm registry versions (read-only)
  update <package> <version>      Stage exact manifest and lock changes separately
  update-apply <update-id>        Apply reviewed staged files, require new qualification

Run options:
  --suite server|client|islands|signals  (signals is host diagnostic only)
  --mode qualified|diagnostic           Default: qualified, never automatic fallback
  --profile native-8-v1|gha-4-v1         Default: native-8-v1
  --cars forma,react-node               Client suite uses its complete fixed grid
  --events 1,5-7                        Server events; default all 1–8
  --forma-ref current|<exact-SHA>  Server/client candidate, alongside frozen inputs
  --baseline                           Frozen server recipes at their exact source
  --chrome <path> --chrome-sha256 <hash> Locked browser for client/islands
  --seed <integer> --id <new-run-id> --keep-generated

No winner score. Keep raw samples, failed runs, exact versions, and uncertainty.
Read README.md and docs/PERFORMANCE-HISTORY.md before changing a measured path.
`;
const print=value=>console.log(typeof value==='string'?value:JSON.stringify(value,null,2));
export async function executeRun(root,options) {
  const plan=makePlan(root,options),id=options.id||'r-'+new Date().toISOString().slice(0,10)+'-'+randomUUID();
  const dir=runPath(root,id);
  if(fs.existsSync(dir))throw Error('Run ID already exists; evidence cannot be overwritten');
  const unlock=acquire(root,id);
  let manifest,exitCode=1,interrupted=false;
  try {
    fs.mkdirSync(path.dirname(dir),{recursive:true});fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'artifacts'));
    const source=sourceIdentity(root);
    manifest={schemaVersion:1,id,protocolVersion:config(root).protocolVersion,testHash:source.testHash,
      config:{suite:plan.suite,profile:plan.profile,seed:plan.seed,cars:plan.cars,events:plan.events,baseline:plan.baseline},
      environment:environment(),source,plan,expected:plan.expected,mode:plan.mode,quality:plan.mode==='diagnostic'?'diagnostic':'qualification-pending',
      status:'running',startedAt:new Date().toISOString()};
    writeJSON(path.join(dir,'manifest.json'),manifest,true);
    manifest.preflight=preflight(root,plan);writeJSON(path.join(dir,'manifest.json'),manifest);
    if(!manifest.preflight.ok) {
      manifest.status='blocked';manifest.error='Prerequisites failed; no measurements started.';
      for(const c of manifest.preflight.checks) console.log(`${c.ok?'PASS':'BLOCK'} ${c.name}: ${c.detail}`);
    } else {
      const log=fs.openSync(path.join(dir,'run.log'),'wx');
      const env={...process.env,GP_RUN_ID:id,GP_RESULTS_DIR:path.join(dir,'artifacts'),GP_SEED:String(plan.seed),GP_PROFILE:plan.profile};
      // Stale inherited campaign/output selectors cannot contaminate a new session.
      for(const k of ['GP_RAW_DIR','GP_CAMPAIGN_FILE','GP_CAMPAIGN_JSON','GP_RESOURCE_PROFILE','GP_IMAGE_PREFIX','GP_ACCEPT_ENCODING','GP_OUT'])delete env[k];
      console.log(`${id}: ${plan.suite}, ${plan.mode}; writing ${path.relative(root,dir)}`);
      try {
        exitCode=await new Promise((resolve,reject)=>{
          unlock.update({phase:'starting-worker'});
          const child=spawn(plan.command[0],plan.command.slice(1),{cwd:root,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
          if(child.pid)unlock.update({phase:'running',workerPid:child.pid,...(process.platform!=='win32'?{workerProcessGroup:child.pid}:{})});
          const cancel=signal=>{interrupted=true;try{if(process.platform!=='win32')process.kill(-child.pid,signal);else child.kill(signal);}catch(e){if(e.code!=='ESRCH')throw e;}};
          const int=()=>cancel('SIGINT'),term=()=>cancel('SIGTERM');
          process.once('SIGINT',int);process.once('SIGTERM',term);
          const clear=()=>{process.removeListener('SIGINT',int);process.removeListener('SIGTERM',term);};
          child.stdout.on('data',d=>{fs.writeSync(log,d);process.stdout.write(d);});
          child.stderr.on('data',d=>{fs.writeSync(log,d);process.stderr.write(d);});
          child.once('error',e=>{clear();unlock.update({phase:'finishing'});reject(e);});
          child.once('close',code=>{clear();unlock.update({phase:'finishing'});resolve(code??1);});
        });
      }finally{fs.closeSync(log);}
      manifest.status=interrupted?'interrupted':exitCode===0?'completed':'failed';manifest.exitCode=exitCode;
      manifest.sourceAfter=sourceIdentity(root).sourceHash;
      if(manifest.sourceAfter!==source.sourceHash){manifest.status='invalid';manifest.error='Inputs changed during execution';exitCode=1;}
    }
  }catch(e){if(!manifest)throw e;manifest.status='failed';manifest.error=e.message;exitCode=1;}
  finally {
    if(manifest){manifest.finishedAt=new Date().toISOString();writeJSON(path.join(dir,'manifest.json'),manifest);}
    unlock();
  }
  // Evidence report precedes disposable-artifact removal. Cleanup cannot delete raw files.
  generateReport(dir);
  if(!options['keep-generated']) {
    try {const plan=await planCleanup(root,{runId:id,includeDependencies:true});
      if(plan.blocked.length)throw Error(plan.blocked.join(' '));
      const receipt=await applyCleanup(root,plan);manifest.cleanup={completed:receipt.completed,receipt:path.relative(dir,receipt.receiptPath),plannedBytes:receipt.plannedBytes};
    }catch(e){manifest.cleanup={completed:false,error:e.message};exitCode=1;}
  }else manifest.cleanup={completed:false,retainedByRequest:true};
  const report=collectReport(dir);
  manifest.quality=plan.mode==='diagnostic'?'diagnostic':manifest.status==='completed'&&report.measurements.length&&report.measurements.every(m=>m.qualification==='qualified'&&(m.status==='measured'||(m.status==='unavailable'&&m.required===false)))?'qualified':'unqualified';
  writeJSON(path.join(dir,'manifest.json'),manifest);generateReport(dir);seal(dir);
  console.log(`Retained ${id}: ${manifest.status}, ${manifest.quality}. Report: ${path.join(dir,'report.html')}`);
  return {id,dir,exitCode,manifest};
}
export async function main(argv=process.argv.slice(2),root=ROOT) {
  const [command='help',...rest]=argv,options=parseOptions(rest);
  for(const flag of ['apply','dependencies','docker'])if(options[flag]!==undefined&&options[flag]!==true)throw Error('--'+flag+' does not take a value');
  if(['help','--help','-h'].includes(command)){print(help);return 0;}
  if(command==='dashboard'){assertOptions(options,[]);const {generateDashboard}=await import('./dashboard.mjs');print(generateDashboard(root));return 0;}
  if(command==='import-evidence'){assertOptions(options,['id']);if(options._.length!==1||!options.id)throw Error('Supply retained archive path and --id');print(importEvidence(root,options._[0],options.id));return 0;}
  if(command==='catalog'){assertOptions(options,[]);print(config(root));return 0;}
  if(command==='changes') {assertOptions(options,[]);const ledger=readLedger(path.join(root,'config/change-ledger.json'));print(renderChanges(ledger));return 0;}
  if(command==='plan'||command==='doctor'){const plan=makePlan(root,options);if(command==='plan'){print(plan);return 0;}const checks=preflight(root,plan);print(checks);return checks.ok?0:1;}
  if(command==='run') return (await executeRun(root,options)).exitCode;
  if(command==='recover'){assertOptions(options,['apply']);if(options._.length!==1)throw Error('Supply a run ID');const plan=planRecovery(root,{runId:options._[0]});if(!options.apply){print(plan);return 0;}const receipt=applyRecovery(root,plan);const dir=runPath(root,options._[0]);generateReport(dir);seal(dir);print(receipt);return 0;}
  if(command==='history'){assertOptions(options,[]);for(const m of history(root))print(`${m.id}  ${m.status}  ${m.quality}  ${m.config?.suite||'historical import'}  ${m.observedAt||m.startedAt}`);return 0;}
  if(command==='updates'){assertOptions(options,[]);print(await checkUpdates(root));return 0;}
  if(command==='update'){assertOptions(options,[]);if(options._.length!==2)throw Error('Supply package and exact version');print(stageUpdate(root,...options._));return 0;}
  if(command==='update-apply'){assertOptions(options,[]);if(options._.length!==1)throw Error('Supply staged update ID');print(applyUpdate(root,options._[0]));return 0;}
  if(command==='compare') {
    assertOptions(options,[]);if(options._.length!==2)throw Error('Supply baseline and current run IDs');
    const dirs=options._.map(id=>runPath(root,id));for(const dir of dirs){const integrity=verify(dir);if(!integrity.ok)throw Error('Evidence integrity failed: '+integrity.problems.join('; '));}
    print(compareRuns(...dirs));return 0;
  }
  if(['report','verify','cleanup'].includes(command)) {
    assertOptions(options,command==='cleanup'?['apply','dependencies','docker']:[]);
    if(options._.length!==1)throw Error('Supply one run ID');
    const id=options._[0],dir=runPath(root,id);
    if(command==='verify'){const result=verify(dir);print(result);return result.ok?0:1;}
    const integrity=verify(dir);if(!integrity.ok)throw Error('Evidence integrity failed: '+integrity.problems.join('; '));
    if(command==='report'){generateReport(dir);seal(dir);print(path.join(dir,'report.html'));return 0;}
    const plan=await planCleanup(root,{runId:id,includeDependencies:Boolean(options.dependencies),includeDocker:Boolean(options.docker)});
    if(!options.apply){print(plan);return 0;}
    print(await applyCleanup(root,plan));seal(dir);return 0;
  }
  throw Error('Unknown command '+command+'; use help');
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {process.exitCode=await main();}catch(error){console.error('Grand Prix: '+error.message);process.exitCode=1;}
}
