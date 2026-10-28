import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const config = root => readJSON(path.join(root, 'config/laboratory.json'));
export const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,95}$/.test(id);
export function writeJSON(file, value, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) fs.writeFileSync(file, text, { flag: 'wx' });
  else { const tmp = file + '.' + randomUUID() + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }
}
export function safePath(root, relative) {
  const base = path.resolve(root), dest = path.resolve(root, relative);
  if (dest !== base && !dest.startsWith(base + path.sep)) throw Error('Path escapes laboratory');
  let part = base;
  if (fs.lstatSync(base).isSymbolicLink()) throw Error('Laboratory root cannot be a symlink');
  for (const p of path.relative(base, dest).split(path.sep).filter(Boolean)) {
    part = path.join(part, p);
    try {if(fs.lstatSync(part).isSymbolicLink())throw Error('Symlink refused: '+part);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return dest;
}
export function runPath(root, id) {
  if (!validId(id)) throw Error('Invalid run ID: use lowercase letters, digits and hyphens');
  return safePath(root, path.join('runs', id));
}
export function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
const excluded = new Set(['node_modules', 'target', 'dist', '.next', '.astro', '.react-router', '.git', 'logs']);
export function filesIn(root, skip = excluded) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(e => {
    if (e.isSymbolicLink() || skip.has(e.name)) return [];
    const f = path.join(root,e.name);
    return e.isDirectory() ? filesIn(f, skip) : e.isFile() ? [f] : [];
  });
}
export function sourceIdentity(root) {
  const entries = ['harness','client-race','signals-race','island-race','shared','contestants','src','config']
    .flatMap(dir => filesIn(path.join(root,dir))).filter(f => !f.endsWith('.test.mjs'));
  const files = Object.fromEntries(entries.map(f => [path.relative(root,f).split(path.sep).join('/'), hash(fs.readFileSync(f))]).sort(([a],[b])=>a.localeCompare(b)));
  const dependencies = Object.fromEntries(Object.entries(files).filter(([p]) => /(?:package(?:-lock)?\.json|Cargo\.(?:lock|toml)|deno\.(?:json|lock)|Dockerfile)$/.test(p)));
  const tests = Object.fromEntries(Object.entries(files).filter(([p]) => !Object.hasOwn(dependencies,p) && !p.startsWith('src/') && !p.startsWith('config/') && !/report|score|\.md$/.test(p)));
  for (const p of ['ROUND-2.md','CONTRACT.md','PROTOCOL.md']) if (fs.existsSync(path.join(root,p))) tests[p]=hash(fs.readFileSync(path.join(root,p)));
  return { commit: git(root,['rev-parse','HEAD']), dirty: Boolean(git(root,['status','--porcelain'])), files, testHash: hash(JSON.stringify(tests)), dependencyHash: hash(JSON.stringify(dependencies)), sourceHash: hash(JSON.stringify(files)) };
}
export function environment() {
  return { platform:process.platform, architecture:process.arch, kernel:os.release(), cpu:os.cpus()[0]?.model ?? 'unknown', cpus:os.availableParallelism(), memoryBytes:os.totalmem(), node:process.version, hostHash:hash(os.hostname()) };
}
export function parseOptions(argv) {
  const out = { _:[] };
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (!arg.startsWith('--')) {out._.push(arg);continue;}
    const key=arg.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(key) || Object.hasOwn(out,key)) throw Error('Invalid or duplicate option: '+arg);
    out[key] = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
export function assertOptions(options, allowed) {
  for (const k of Object.keys(options)) if (k !== '_' && !allowed.includes(k)) throw Error('Unknown option --'+k);
}
export function seededOrder(items, seed) {
  let value=seed>>>0;const out=[...items];
  for(let i=out.length-1;i>0;i--){value=(Math.imul(1664525,value)+1013904223)>>>0;const j=value%(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
export function makePlan(root, options={}) {
  assertOptions(options,['suite','mode','profile','cars','events','forma-ref','chrome','chrome-sha256','seed','id','baseline','keep-generated']);
  if(options._?.length)throw Error('Unexpected positional arguments');
  for(const key of ['baseline','keep-generated'])if(options[key]!==undefined&&options[key]!==true)throw Error('--'+key+' does not take a value');
  if(options.id!==undefined&&!validId(options.id))throw Error('Invalid run ID');
  const cfg=config(root), suite=options.suite || 'server', spec=cfg.suites[suite];
  if(!spec) throw Error('Unknown suite: '+suite);
  const mode=options.mode || cfg.defaultMode;
  if(!['qualified','diagnostic'].includes(mode)) throw Error('Mode must be qualified or diagnostic');
  if(spec.diagnosticOnly && mode !== 'diagnostic') throw Error('Host signals are diagnostic only; use the client Linux suite for qualified signals');
  const profile=options.profile || cfg.defaultProfile;
  if(!['native-8-v1','gha-4-v1'].includes(profile)) throw Error('Unknown resource profile');
  const seed=Number(options.seed ?? cfg.seed);
  if(!Number.isSafeInteger(seed) || seed<0 || seed>0xffffffff) throw Error('Seed must be an unsigned 32-bit integer');
  let cars=options.cars ? String(options.cars).split(',') : spec.cars;
  if(!cars.length || new Set(cars).size!==cars.length || cars.some(c=>!spec.cars.includes(c))) throw Error('Invalid or duplicate entrant selection');
  if(suite!=='client')cars=seededOrder(cars,seed);
  if(suite==='client' && options.cars) throw Error('Paired client suite runs its complete fixed grid; car filtering would break the campaign contract');
  if(options.events && suite!=='server') throw Error('--events applies to the server suite');
  let events=spec.events;
  if(options.events) {
    const indices=[];
    for(const p of String(options.events).split(',')) {
      const m=p.match(/^([1-8])(?:-([1-8]))?$/);
      if(!m || (m[2] && +m[2]<+m[1])) throw Error('Server events must be 1–8, e.g. 1,5-7');
      for(let n=+m[1];n<=+(m[2]||m[1]);n++) indices.push(n);
    }
    events=[...new Set(indices)].sort().map(n=>spec.events[n-1]);
  }
  const formaRef=options['forma-ref']==='current'?cfg.currentForma.sourceCommit:options['forma-ref'];
  if(formaRef && !/^[a-f0-9]{40}$/.test(formaRef)) throw Error('Forma source must be an exact 40-character commit');
  if(formaRef && !['server','client'].includes(suite)) throw Error('--forma-ref is supported by server and client suites');
  if(options.baseline && suite!=='server') throw Error('--baseline applies to server input recipes');
  const args=[spec.driver];
  if(suite==='server') {args.push('--cars',cars.join(','),'--events',events.map(e=>spec.events.indexOf(e)+1).join(','));if(options.baseline)args.push('--baseline');if(formaRef)args.push('--forma-ref',formaRef);}
  if(suite==='client' && formaRef) args.push('--forma-refs',formaRef);
  if(suite==='islands' || suite==='signals') args.push('--cars',cars.join(','));
  if(mode==='diagnostic' && suite!=='signals') args.push('--diagnostic');
  if(suite==='signals') args.push('--runs','5','--warmups','2');
  if(['client','islands'].includes(suite)) {
    if(options.chrome) args.push('--chrome',String(options.chrome));
    if(options['chrome-sha256'] && suite==='client') args.push('--chrome-sha256',String(options['chrome-sha256']));
  }
  const expected = suite==='client' ? [] : events.flatMap(event=>cars.map(car=>({event,car})));
  return {schemaVersion:1,suite,mode,profile,seed,cars,events,expected,formaRef:formaRef||null,baseline:Boolean(options.baseline),command:[process.execPath,...args],requires:spec.requires,
    description: mode==='qualified' ? 'Requires native Linux, authenticated campaign and unchanged correctness/resource gates.' : 'Diagnostic observations; never qualify for release or performance improvement claims.'};
}
export function preflight(root,plan) {
  const checks=[], add=(name,ok,detail)=>checks.push({name,ok,detail});
  const stat=fs.statfsSync(root);add('free disk',stat.bavail*stat.bsize>=config(root).minimumFreeBytes,`${stat.bavail*stat.bsize} bytes available`);
  for(const need of plan.requires) {
    if(need==='linux') add('native Linux',process.platform==='linux',process.platform);
    if(need==='docker') {const p=spawnSync('docker',['info','--format','{{.ServerVersion}}'],{encoding:'utf8',timeout:15000});add('Docker engine',p.status===0,p.stdout?.trim()||p.stderr?.trim()||p.error?.message||'Docker did not return engine information');}
    if(need==='cleanGit') {const s=git(root,['status','--porcelain']);add('committed source',s==='',s===null?'Git unavailable':s||'clean');}
    if(need==='chromium') {const i=plan.command.indexOf('--chrome'),f=i<0?process.env.CHROME_PATH:plan.command[i+1];add('Chromium executable',Boolean(f&&fs.existsSync(f)),f||'Supply --chrome and the locked executable hash');}
    if(need==='signalsDependencies') add('signals dependencies',fs.existsSync(path.join(root,'signals-race/node_modules/@getforma/core/package.json')),'Install with npm ci --prefix signals-race');
  }
  return {ok:checks.every(c=>c.ok),checks};
}
export function acquire(root,runId, details={operation:'run',phase:'preflight'}) {
  if(!validId(runId)) throw Error('Invalid run ID');
  const file=safePath(root,'.grandprix/active.json');
  const lock={...details,pid:process.pid,runId,hostname:os.hostname(),startedAt:new Date().toISOString()};
  try {writeJSON(file,lock,true);} catch(e) {if(e.code==='EEXIST')throw Error('Another run or an interrupted run owns .grandprix/active.json. Inspect it before recovering; no automatic lock stealing.');throw e;}
  const owned=()=>{const current=readJSON(file);if(current.pid!==process.pid||current.runId!==runId)throw Error('Run lock ownership changed');return current;};
  const release=()=>{owned();fs.unlinkSync(file);};
  release.update=fields=>writeJSON(file,{...owned(),...fields,pid:process.pid,runId});
  return release;
}
export function evidenceFiles(root) {
  const skip=new Set(['node_modules','target','dist','.next','.astro','.react-router','.git']);
  function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
    const f=path.join(dir,e.name);
    if(e.isSymbolicLink())throw Error('Evidence symlink refused: '+f);
    if(skip.has(e.name))return [];
    return e.isDirectory()?walk(f):e.isFile()?[f]:[];
  });}
  return walk(root);
}
export function seal(runDir) {
  const files=Object.fromEntries(evidenceFiles(runDir).filter(f=>!['integrity.json'].includes(path.basename(f))&&!f.endsWith('.tmp')).map(f=>[path.relative(runDir,f).split(path.sep).join('/'),hash(fs.readFileSync(f))]));
  writeJSON(path.join(runDir,'integrity.json'),{schemaVersion:1,algorithm:'sha256',files});
  return {files:Object.keys(files).length};
}
export function verify(runDir) {
  const receipt=readJSON(path.join(runDir,'integrity.json')),problems=[];
  if(receipt.algorithm!=='sha256'||!receipt.files||typeof receipt.files!=='object') throw Error('Invalid integrity manifest');
  for(const [relative,expected] of Object.entries(receipt.files)) {
    try {const f=safePath(runDir,relative);if(hash(fs.readFileSync(f))!==expected) problems.push(relative+': changed');}
    catch(e){problems.push(relative+': '+e.message);}
  }
  try {for(const f of evidenceFiles(runDir)) {const p=path.relative(runDir,f).split(path.sep).join('/');if(p!=='integrity.json'&&!Object.hasOwn(receipt.files,p)) problems.push(p+': unsealed addition');}} catch(e){problems.push(e.message);}
  return {ok:problems.length===0,checked:Object.keys(receipt.files).length,problems};
}
export function history(root) {
  const dir=safePath(root,'runs');if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(validId).flatMap(id=>{try{return [readJSON(path.join(runPath(root,id),'manifest.json'))];}catch{return [];}}).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
}
