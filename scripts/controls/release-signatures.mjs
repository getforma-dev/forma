import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const self = fileURLToPath(import.meta.url);
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const hash = (path, algorithm='sha256', encoding='hex') => createHash(algorithm).update(readFileSync(path)).digest(encoding);
if (process.argv[2] === '--registry') {
  const data = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  let malformed = false;
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (req.url === '/-/npm/v1/keys') return res.end(JSON.stringify({ keys: [data.key] }));
    const archive = data.records.find(r => req.url === `/external-${r.version}.tgz`);
    if (archive) { res.setHeader('content-type', 'application/octet-stream'); return res.end(readFileSync(archive.tarball)); }
    if (req.url?.split('?')[0] === '/forma-signature-control-external') {
      const versions = Object.fromEntries(data.records.map(r => [r.version, {name:data.name, version:r.version, dist:{tarball:`http://127.0.0.1:${server.address().port}/external-${r.version}.tgz`, integrity:r.integrity, signatures:[{keyid:data.key.keyid,sig:malformed?Buffer.from('invalid-signature').toString('base64'):r.signature}]}}]));
      return res.end(JSON.stringify({name:data.name,'dist-tags':{latest:'2.0.0'},versions,time:Object.fromEntries(data.records.map(r=>[r.version,'2026-01-01T00:00:00.000Z']))}));
    }
    res.statusCode = 404; res.end(JSON.stringify({error:'package deliberately unpublished'}));
  });
  server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('message', message => {
    if (message.command === 'malformed') { malformed = true; process.send({ready:true}); }
    if (message.command === 'requests') { process.send({requests}); }
    if (message.command === 'stop') server.close(() => process.exit());
  });
} else {
  const helper = resolve(process.argv[2]);
  const output = resolve(process.argv[3] ?? join(dirname(self), 'result.json'));
  const root = mkdtempSync(join(tmpdir(), 'forma-real-signature-control-'));
  const artifacts = join(root, 'artifacts'), project = join(root, 'consumer');
  mkdirSync(artifacts); mkdirSync(project);
  let registry;
  const report = { helper, node: process.version, npm: execFileSync('npm',['--version'],{encoding:'utf8'}).trim(), controls: [] };
  const pack = (manifest) => {
    const stage = mkdtempSync(join(root, 'pack-')); mkdirSync(join(stage, 'package'));
    save(join(stage, 'package/package.json'), manifest);
    writeFileSync(join(stage, 'package/index.js'), 'export const fixture = true;\n');
    const filename = `${manifest.name.replace('@','').replace('/','-')}-${manifest.version}.tgz`;
    const path = join(artifacts, filename);
    execFileSync('tar', ['-czf', path, '-C', stage, 'package']);
    return {path, file: filename, integrity:`sha512-${hash(path,'sha512','base64')}`, sha256:hash(path)};
  };
  try {
    const name = 'forma-signature-control-external';
    const external = pack({name, version:'1.0.0',type:'module'});
    const external2 = pack({name,version:'2.0.0',type:'module'});
    const {privateKey, publicKey} = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const key = publicKey.export({type:'spki',format:'der'}).toString('base64');
    const keyid = 'SHA256:'+createHash('sha256').update(key).digest('base64');
    const records = [[external,'1.0.0'],[external2,'2.0.0']].map(([p,version])=>({version,tarball:p.path,integrity:p.integrity,signature:sign('sha256',Buffer.from(`${name}@${version}:${p.integrity}`),privateKey).toString('base64')}));
    const registryData = join(root,'registry.json');
    save(registryData,{name,records,key:{keyid,key,expires:null,keytype:'ecdsa-sha2-nistp256',scheme:'ecdsa-sha2-nistp256'}});
    registry = fork(self,['--registry',registryData],{stdio:['ignore','ignore','inherit','ipc']});
    const [{port}] = await once(registry,'message');
    const url = `http://127.0.0.1:${port}/`;
    const version='3.0.0-dev';
    const manifests = [
      {name:'@getforma/core',version,type:'module',devDependencies:{[name]:'=1.0.0','forma-signature-control-uninstalled-dev':'=9.9.9'}},
      {name:'@getforma/compiler',version,type:'module',dependencies:{[name]:'=1.0.0'},peerDependencies:{'@getforma/core':`=${version}`}},
      {name:'@getforma/build',version,type:'module',peerDependencies:{'@getforma/compiler':`=${version}`},peerDependenciesMeta:{'@getforma/compiler':{optional:true}}},
    ];
    const packages=manifests.map(manifest=>({...pack(manifest),registry:'npm',name:manifest.name,version,manifest}));
    const dependencies={...Object.fromEntries(packages.map(p=>[p.name,`file:${p.path}`])),[name]:'=2.0.0'};
    save(join(project,'package.json'),{name:'forma-signature-control',version:'1.0.0',private:true,dependencies});
    const lock={name:'forma-signature-control',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'forma-signature-control',version:'1.0.0',dependencies}}};
    for(const p of packages) lock.packages[`node_modules/${p.name}`]={...p.manifest,resolved:`file:${p.path}`,integrity:p.integrity};
    lock.packages[`node_modules/${name}`]={name,version:'2.0.0',resolved:url+'external-2.0.0.tgz',integrity:external2.integrity};
    lock.packages[`node_modules/@getforma/compiler/node_modules/${name}`]={name,version:'1.0.0',resolved:url+'external-1.0.0.tgz',integrity:external.integrity};
    save(join(project,'package-lock.json'),lock);
    writeFileSync(join(project,'.npmrc'),`registry=${url}\nignore-scripts=true\nfetch-retries=0\nfetch-timeout=15000\n`);
    const env={...process.env,npm_config_registry:url,npm_config_fetch_retries:'0',npm_config_fetch_timeout:'15000',npm_config_cache:join(root,'npm-cache')};
    const execute=(command,args,cwd=project,options={})=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:16*1024*1024,...options,env:{...env,...options.env},cwd});
    execute('npm',['ci','--ignore-scripts','--no-audit','--no-fund']);
    let unprojected;
    try { execute('npm',['audit','signatures','--json']); } catch(error) { unprojected=String(error.stdout)+String(error.stderr); }
    assert(unprojected?.includes('@getforma/'), 'unprojected audit must query an unpublished candidate');
    report.controls.push({name:'unprojected real npm rejects unpublished exact candidate edge',passed:true});
    const {auditCandidateSignatures}=await import(pathToFileURL(helper));
    const accepted=auditCandidateSignatures(project,packages,artifacts,{execute});
    assert.equal(accepted.localCandidates.length,3);
    assert.deepEqual(accepted.registryDependencies.map(p=>p.version).sort(),['1.0.0','2.0.0']);
    assert(accepted.registryDependencies.some(p=>p.location===`node_modules/@getforma/compiler/node_modules/${name}`));
    report.controls.push({name:'projected real npm validates external signature and authenticates all three candidates',passed:true,inventory:accepted});
    registry.send({command:'malformed'}); await once(registry,'message');
    // A separate cache makes the malformed registry result observable even if npm cached its valid control.
    env.npm_config_cache=join(root,'npm-cache-malformed');
    let rejected;
    try { auditCandidateSignatures(project,packages,artifacts,{execute}); } catch(error) { rejected=String(error.stdout)+String(error.stderr)+String(error); }
    assert(rejected?.includes('EINTEGRITYSIGNATURE'), 'real npm must reject the malformed external signature');
    report.controls.push({name:'projected real npm rejects malformed external signature',passed:true,diagnostic:'EINTEGRITYSIGNATURE'});
    registry.send({command:'requests'}); const [{requests}]=await once(registry,'message'); report.registryRequests=requests;
    assert(!requests.some(path=>path.includes('uninstalled-dev')), 'candidate dev-only dependency must not be queried');
    report.passed=true; save(output,report); console.log(JSON.stringify(report,null,2));
  } catch(error) { report.passed=false; report.error=error.stack; report.stdout=String(error.stdout??''); report.stderr=String(error.stderr??''); save(output,report); throw error; }
  finally { if(registry?.connected)registry.send({command:'stop'}); rmSync(root,{recursive:true,force:true}); }
}
