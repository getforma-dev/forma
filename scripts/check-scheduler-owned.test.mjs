// Linux-only fake-child integration. No browser, Cargo, or original workload.
// Keep every supervisor/worker log, including deliberate refusal controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ownedCommand, runPair, freshEvidencePath } from './check-scheduler-pair.mjs';
import { ROOT } from './check-core-partition.mjs';
import { spawnProofProcess, stopProofProcess } from './router-proof-process.mjs';
import { collectResourceInputs } from './check-scheduler-admission.mjs';
import { buildPackages, parentIdentity } from './check-compile-phase.mjs';

assert.equal(process.platform, 'linux', 'actual owner controls require Linux; never count a platform skip as evidence');
const evidence = freshEvidencePath(process.env.FORMA_SCHEDULER_CONTROL_EVIDENCE ?? '');
mkdirSync(evidence);
const specs = [{ id: 'a', browserWorkers: 0, cargoPools: 0 }, { id: 'b', browserWorkers: 2, cargoPools: 0 }];
const save = (name, value) => writeFileSync(resolve(evidence, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
const node = code => [process.execPath, '-e', code];
const cleaned = outcome => {
  assert.equal(outcome.owner.cleanup.complete, true);
  assert.deepEqual(outcome.owner.cleanup.remainingOwnedPids, []);
  assert.equal(outcome.outerGroup.processGroupGone, true);
};
test('live Linux PID1 identity is readable without signaling the container init', () => {
  const identity = parentIdentity(1);
  assert.equal(identity.pid, 1); assert.match(identity.startTime, /^\d+$/);
  for (const invalid of [0, -1, 1.5, NaN]) assert.throws(() => parentIdentity(invalid), /original live parent/);
  save('pid1-identity-control', { ...identity, readOnly: true, signalsSent: 0 });
});
test('the unchanged Linux subreaper passes its own actual launch, descendant, deadline and logging controls', () => {
  const result = spawnSync('python3', [resolve(ROOT, 'scripts/release-owned-linux.test.py')], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  save('inherited-owner-controls', { complete: result.status === 0 && !result.signal && !result.error,
    status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message ?? null });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
});
test('both wrapper-owned lanes preserve complete output and successful cleanup', async () => {
  const record = await runPair({ specs, verifyInputs() {}, save: value => save('success-join', value),
    start: spec => ownedCommand(node(`process.stdout.write(${JSON.stringify('x'.repeat(65536) + 'FINAL-TAIL\n')})`), resolve(evidence, `success-${spec.id}`), 10) });
  assert.equal(record.complete, true);
  for (const row of record.lanes) {
    cleaned(row.outcome);
    assert.equal(readFileSync(resolve(evidence, `success-${row.id}/worker.log`), 'utf8'), 'x'.repeat(65536) + 'FINAL-TAIL\n');
  }
});
test('peer failure cancels a closed-output child, joins cleanup, and leaves unrelated processes alone', async () => {
  const marker = resolve(evidence, 'cancel-ready');
  const unrelated = spawnProofProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  try {
    const programs = {
      a: `const fs=require('node:fs');const end=Date.now()+5000;const interval=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(interval);process.exit(7)}else if(Date.now()>end){process.exit(8)}},10)`,
      b: `const fs=require('node:fs');fs.closeSync(1);fs.closeSync(2);fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`,
    };
    const record = await runPair({ specs, verifyInputs() {}, save: value => save('failure-join', value),
      start: spec => ownedCommand(node(programs[spec.id]), resolve(evidence, `failure-${spec.id}`), 10) });
    assert.equal(record.complete, false); assert(existsSync(marker));
    assert.equal(record.lanes[0].outcome.owner.exitCode, 7);
    assert.equal(record.lanes[1].cancelRequested, 'a failed');
    assert(record.lanes[1].outcome.owner.faults.some(value => value.includes('interruption')));
    for (const row of record.lanes) cleaned(row.outcome);
    assert.equal(unrelated.ended, false); process.kill(unrelated.child.pid, 0);
  } finally { save('unrelated-cleanup', await stopProofProcess(unrelated)); }
});
test('detached descendants, command launch refusal and deadlines cannot become passing outcomes', async () => {
  const detached = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(child.pid);child.unref()`;
  const cases = [
    ['detached', node(detached), 10],
    ['launch', ['/forma-scheduler-control/no-such-command'], 10],
    ['deadline', node('setInterval(()=>{},1000)'), 0.2],
  ];
  for (const [name, command, seconds] of cases) {
    const outcome = await ownedCommand(command, resolve(evidence, name), seconds).closed;
    save(`${name}-outcome`, outcome); assert.equal(outcome.complete, false); cleaned(outcome);
    if (name === 'detached') {
      assert(outcome.owner.faults.includes('producer left live descendants'));
      assert(outcome.owner.cleanup.captured.some(row => row.state !== 'Z'));
    }
  }
});

// Execute the actual compile coordinator, source seal, original stage bodies,
// Linux owners and parent import. Only npm/Cargo/old-reader producers are
// explicit stand-ins; these controls do not claim a real compile or R17 pass.
function compileFixture(name, mode, actualCheck = false) {
  const directory = resolve(evidence, `compile-${name}`), root = resolve(directory, 'source'), outside = resolve(directory, 'external');
  mkdirSync(root, { recursive: true }); mkdirSync(outside);
  const write = (path, text, options) => { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), text, options); };
  const files = ['check.sh', 'check-core-partition.mjs', 'check-scheduler-admission.mjs', 'check-scheduler-pair.mjs', 'check-compile-phase.mjs',
    'check-scheduler-lanes.sh', 'check-stages.sh', 'check-builds.sh', 'router-proof-process.mjs', 'portable-command.mjs', 'release-owned-linux.py', 'check-scheduler-workload.json'];
  for (const file of files) write(`scripts/${file}`, readFileSync(resolve(ROOT, 'scripts', file)));
  const inventory = { schema: 1, groups: { unit: [], browser: [] } };
  for (const [kind, paths] of Object.entries({ unit: ['src/dom/__tests__/list-lis.test.ts', 'src/expr/__tests__/native-cost.test.ts', 'src/ordinary.test.ts'],
    browser: ['e2e/expr-cost.spec.ts', 'e2e/sr33.spec.ts', 'e2e/state-roundtrip.spec.ts', 'e2e/ordinary.spec.ts'] })) {
    for (const file of paths) { write(`packages/core/${file}`, 'controlled source'); inventory.groups[kind].push({ file,
      sha256: createHash('sha256').update('controlled source').digest('hex'), phase: file.includes('ordinary') ? 'overlap' : 'exclusive' }); }
  }
  write('scripts/check-core-partition.json', JSON.stringify(inventory));
  for (const pkg of buildPackages) write(`${pkg}/package.json`, JSON.stringify({ version: '3.2.0-rc.4' }));
  write('package-lock.json', '{}');
  const common = `const fs=require('node:fs'),path=require('node:path');const mode=process.env.COMPILE_CONTROL_MODE;fs.appendFileSync(process.env.COMPILE_CONTROL_LOG,JSON.stringify({tool:path.basename(process.argv[1]),args:process.argv.slice(2),cwd:process.cwd(),cargoJobs:process.env.CARGO_BUILD_JOBS})+'\\n');`;
  write('bin/npm', `#!${process.execPath}\n${common}
    if(process.argv[2]!=='run'){require('node:assert/strict').ok([['ci','--ignore-scripts'],['audit','--omit=dev'],['audit','signatures']].some(args=>JSON.stringify(args)===JSON.stringify(process.argv.slice(2))));process.exit(0);}
    require('node:assert/strict').deepEqual(process.argv.slice(2),['run','build']);
    fs.writeFileSync(process.env.COMPILE_CONTROL_READY,'ready');
    if(mode==='npm-fail')process.exit(21);
    if(mode==='parent-death'){setInterval(()=>{},1000);}else
    setTimeout(()=>{fs.mkdirSync('dist',{recursive:true});for(const name of ['index.js','index.d.ts','raw-lint-cli.js','formajs-runtime.global.js','forma.esm.js','formajs-frame.global.js'])fs.writeFileSync('dist/'+name,'fresh:'+process.cwd()+':'+name);},mode==='cargo-fail'?300:10);
  `, { mode: 0o755 });
  write('bin/cargo', `#!${process.execPath}\n${common}
    if(process.argv[2]==='test'){
      const admission=fs.readdirSync(process.env.RUNNER_TEMP).filter(name=>name.startsWith('forma-r17-'));require('node:assert/strict').equal(admission.length,1);
      const phase=path.join(process.env.RUNNER_TEMP,admission[0],'compile');require('node:assert/strict').equal(JSON.parse(fs.readFileSync(path.join(phase,'join.json'))).complete,true);
      require('node:assert/strict').ok(fs.existsSync(path.join(phase,'imported.json')));fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'runtime-guard-boundary'),'after-complete-join-and-import');process.exit(53);
    }
    require('node:assert/strict').equal(process.env.CARGO_BUILD_JOBS,'3');
    if(mode==='cargo-fail') {const timer=setInterval(()=>{if(fs.existsSync(process.env.COMPILE_CONTROL_READY)){clearInterval(timer);process.exit(19)}},5);}
    else if(mode==='npm-fail'||mode==='parent-death')setInterval(()=>{},1000);
  `, { mode: 0o755 });
  write('scripts/test-renderer-window.mjs', `import{appendFileSync}from'node:fs';appendFileSync(process.env.COMPILE_CONTROL_LOG,JSON.stringify({tool:'old-renderer-stand-in'})+'\\n');`);
  for (const file of ['check-router-research.mjs', 'generate-fmir-constants.mjs']) write(`scripts/${file}`, '// Explicit non-workload stand-in for ownership controls.\n');
  const script = `set -euo pipefail
cd "$COMPILE_CONTROL_ROOT"
started=$(date +%s)
scheduler_evidence=$(node scripts/check-scheduler-admission.mjs --admit)
test "$(node scripts/check-scheduler-admission.mjs --mode "$scheduler_evidence")" = linux-overlap
printf '%s' "$scheduler_evidence" > "$COMPILE_CONTROL_EVIDENCE"
node scripts/check-compile-phase.mjs "$scheduler_evidence/compile" "$started"
if [ "$COMPILE_CONTROL_MODE" = corrupt-output ]; then printf 'changed' > packages/core/dist/extra-chunk.js; fi
source scripts/check-builds.sh
forma_check_import_compile "$scheduler_evidence/compile"
for package_dir in packages/compiler packages/build packages/core packages/router packages/create-app; do forma_check_build_package "$package_dir" dist/index.js; done
if node scripts/check-compile-phase.mjs --verify-import "$scheduler_evidence/compile"; then exit 97; fi
echo COMPILE-AND-PRIVATE-REUSE-PASSED
`;
  if (actualCheck) {
    // Instrument only the synthetic s07 boundary; check.sh itself is exact.
    // Reuse is checked before the fake Cargo test exits53, preventing later work.
    const stages = readFileSync(resolve(root, 'scripts/check-stages.sh'), 'utf8');
    write('scripts/check-stages.sh', stages.replace('    s07)\n', '    s07)\n      for package_dir in packages/compiler packages/build packages/core packages/router packages/create-app; do forma_check_build_package "$package_dir" dist/index.js; done\n'));
  }
  write('driver.sh', actualCheck ? 'set -euo pipefail\nexec bash scripts/check.sh\n' : script);
  const git = args => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
  git(['init', '--quiet']);
  git(['-c', 'user.name=Owned control', '-c', 'user.email=control@invalid', 'add', '.']);
  const manifest = { schema: 2, roots: ['scripts', 'packages/core/src', 'packages/core/e2e'], files: ['package-lock.json', 'packages/core/package.json'],
    immediateFiles: ['.', ...buildPackages], excludePaths: [], excludeTrees: [], generatedDirectoryNames: ['node_modules'],
    versionFiles: ['package-lock.json', 'packages/core/package.json'], profiles: {} };
  manifest.profiles['3.2.0-rc.4'] = collectResourceInputs(root, manifest);
  write('scripts/check-scheduler-inputs.json', JSON.stringify(manifest)); git(['add', '.']);
  git(['-c', 'user.name=Owned control', '-c', 'user.email=control@invalid', 'commit', '--quiet', '-m', 'Controlled compile source']);
  const env = { ...process.env, PATH: `${resolve(root, 'bin')}:${dirname(process.execPath)}:${process.env.PATH}`, RUNNER_TEMP: outside,
    CARGO_BUILD_JOBS: '7',
    COMPILE_CONTROL_ROOT: root, COMPILE_CONTROL_LOG: resolve(outside, 'commands.jsonl'), COMPILE_CONTROL_READY: resolve(outside, 'npm-ready'),
    COMPILE_CONTROL_EVIDENCE: resolve(outside, 'evidence-path'), COMPILE_CONTROL_MODE: mode };
  let invocation = ['bash', ['driver.sh']];
  if (mode === 'parent-death') {
    const killer = resolve(outside, 'hold-dead-parent.py');
    writeFileSync(killer, `import os,signal,time,json,pathlib
root=pathlib.Path(os.environ['COMPILE_CONTROL_ROOT']);outside=pathlib.Path(os.environ['RUNNER_TEMP'])
pid=os.fork()
if pid==0: os.chdir(root);os.execvp('bash',['bash','driver.sh'])
coordinator=None;phase=None;observed={}
try:
 end=time.monotonic()+10
 while time.monotonic()<end:
  if pathlib.Path(os.environ['COMPILE_CONTROL_READY']).exists():break
  time.sleep(.01)
 assert pathlib.Path(os.environ['COMPILE_CONTROL_READY']).exists(),'owned children did not start'
 phase=pathlib.Path(pathlib.Path(os.environ['COMPILE_CONTROL_EVIDENCE']).read_text())/'compile'
 children=pathlib.Path('/proc/%s/task/%s/children'%(pid,pid)).read_text().split();assert len(children)==1,children;coordinator=int(children[0])
 os.kill(pid,signal.SIGKILL)
 end=time.monotonic()+10
 while time.monotonic()<end:
  state=pathlib.Path('/proc/%s/stat'%pid).read_text().rsplit(')',1)[1].split()[0]
  observed['deadParentState']=state
  join=json.loads((phase/'join.json').read_text())
  if state=='Z' and join['interrupted'] and all(row.get('outcome',{}).get('owner',{}).get('cleanup',{}).get('complete') for row in join['lanes']):break
  time.sleep(.02)
 assert observed['deadParentState']=='Z',observed
 assert join['interrupted'] and not join['complete'] and all(row['outcome']['owner']['cleanup']['complete'] for row in join['lanes']),join
 observed['refusedWhileOriginalParentUnreaped']=True
finally:
 if coordinator:
  try:os.kill(coordinator,signal.SIGTERM)
  except ProcessLookupError:pass
 try:os.kill(pid,signal.SIGKILL)
 except ProcessLookupError:pass
 observed['waitpid']=os.waitpid(pid,0)
 (outside/'dead-parent-observation.json').write_text(json.dumps(observed,indent=2)+'\\n')
`);
    invocation = ['python3', [killer]];
  }
  const result = spawnSync(invocation[0], invocation[1], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  writeFileSync(resolve(directory, 'execution.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: result.stdout, stderr: result.stderr, scope: 'Actual scheduler/owners/import with explicit npm/Cargo/old-reader stand-ins only.' }, null, 2) + '\n');
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  const admitted = existsSync(env.COMPILE_CONTROL_EVIDENCE) ? readFileSync(env.COMPILE_CONTROL_EVIDENCE, 'utf8')
    : resolve(outside, readdirSync(outside).find(name => name.startsWith('forma-r17-')));
  const phase = resolve(admitted, 'compile');
  const join = JSON.parse(readFileSync(resolve(phase, 'join.json')));
  for (const row of join.lanes) cleaned(row.outcome);
  const commands = readFileSync(env.COMPILE_CONTROL_LOG, 'utf8').trim().split('\n').map(JSON.parse);
  return { result, commands, phase, join, root, env };
}
test('actual owned compile phase transfers all fresh products once and preserves private reuse', () => {
  const { result, commands, phase, root, env } = compileFixture('success', 'success');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /COMPILE-AND-PRIVATE-REUSE-PASSED/);
  assert.equal(commands.filter(row => row.tool === 'npm' && row.args[0] === 'run').length, 5, 'imported products must not cause five duplicate builds');
  assert.deepEqual(commands.filter(row => row.tool === 'npm' && row.args[0] === 'run').map(row => row.cwd), buildPackages.map(path => resolve(root, path)));
  assert.deepEqual(commands.filter(row => row.tool === 'npm').slice(0, 3).map(row => row.args), [['ci', '--ignore-scripts'], ['audit', '--omit=dev'], ['audit', 'signatures']]);
  assert.deepEqual(commands.filter(row => row.tool === 'cargo').map(row => row.args[0]), ['fmt', 'clippy', 'doc']);
  assert.equal(commands.filter(row => row.tool === 'old-renderer-stand-in').length, 1);
  assert(commands.filter(row => row.tool === 'cargo').every(row => row.cargoJobs === '3'));
  assert(commands.filter(row => row.tool === 'npm').every(row => row.cargoJobs === '7'), 'only Cargo side receives bounded jobs override');
  assert(existsSync(resolve(phase, 'imported.json'))); assert.match(result.stderr, /EEXIST/);
  const replay = spawnSync(process.execPath, [resolve(root, 'scripts/check-compile-phase.mjs'), '--verify-import', phase], { cwd: root, env, encoding: 'utf8' });
  writeFileSync(resolve(dirname(root), 'different-parent-replay.json'), JSON.stringify({ status: replay.status, stdout: replay.stdout, stderr: replay.stderr }, null, 2) + '\n');
  assert.notEqual(replay.status, 0); assert.match(replay.stderr, /another parent invocation/);
});
test('actual owned compile failures and post-join output drift cannot import or advance', () => {
  for (const mode of ['cargo-fail', 'npm-fail', 'corrupt-output']) {
    const { result, phase, join, env } = compileFixture(mode, mode, mode !== 'corrupt-output');
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /COMPILE-AND-PRIVATE-REUSE-PASSED/);
    assert.equal(existsSync(resolve(phase, 'imported.json')), false);
    assert.equal(existsSync(resolve(env.RUNNER_TEMP, 'runtime-guard-boundary')), false);
    if (mode === 'corrupt-output') { assert.equal(join.complete, true); assert.match(result.stderr, /output bytes changed/); }
    else { assert.equal(join.complete, false); assert.equal(existsSync(resolve(phase, 'build-receipt.json')), false); }
  }
});
test('actual check entrypoint reaches its first Rust runtime guard only after compile import and cleanup', () => {
  const { result, commands, env } = compileFixture('entrypoint-boundary', 'success', true);
  assert.equal(result.status, 53, result.stdout + result.stderr);
  assert.equal(readFileSync(resolve(env.RUNNER_TEMP, 'runtime-guard-boundary'), 'utf8'), 'after-complete-join-and-import');
  assert.equal(commands.filter(row => row.tool === 'npm' && row.args[0] === 'run').length, 5);
});
test('a dead original parent held as a zombie cancels and joins both actual owned producers', () => {
  const { result, env, join, phase } = compileFixture('dead-parent', 'parent-death');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const observation = JSON.parse(readFileSync(resolve(env.RUNNER_TEMP, 'dead-parent-observation.json')));
  assert.equal(observation.deadParentState, 'Z'); assert.equal(observation.refusedWhileOriginalParentUnreaped, true);
  assert.equal(join.complete, false); assert.equal(join.interrupted, true); assert.equal(existsSync(resolve(phase, 'build-receipt.json')), false);
});
