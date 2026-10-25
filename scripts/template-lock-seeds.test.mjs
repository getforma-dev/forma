import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, stageTemplates, versionFiles } from './release-set.mjs';
import { SEED_MARKER, readTemplateSeeds, validateSeedFiles, prepareTemplateSeeds } from './template-lock-seeds.mjs';

const version = JSON.parse(readFileSync(join(ROOT, 'packages/create-app/package.json'))).version;
const mismatchedVersion = version.includes('-') ? version.split('-')[0] : `${version}-dev`;
const originals = readTemplateSeeds(ROOT, version);
const externalNpm = files => Object.fromEntries(Object.entries(JSON.parse(files.get('admin/package-lock.json')).packages).filter(([path]) => path && !/^node_modules\/@getforma\/(core|compiler|build)$/.test(path)));
const externalCargo = files => files.get('Cargo.lock').split(/(?=^\[\[package\]\])/m).filter(block => !/^name = "forma-(ir|ir-derive|server)"\r?$/m.test(block));
function changed(template, change) { const files = new Map(originals.get(template)); change(files); return () => validateSeedFiles(files, version, template); }
function npm(files, change) { const lock = JSON.parse(files.get('admin/package-lock.json')); change(lock); files.set('admin/package-lock.json', JSON.stringify(lock)); }
function cargo(files, change) { files.set('Cargo.lock', change(files.get('Cargo.lock'))); }
function isolated() {
  const root = mkdtempSync(join(tmpdir(), 'forma-source-seeds-'));
  const files = new Map([[SEED_MARKER, readFileSync(join(ROOT, SEED_MARKER), 'utf8')], ['packages/create-app/package.json', JSON.stringify({version})]]);
  for (const [template, source] of originals) for (const [path, text] of source) files.set(`packages/create-app/templates/${template}/${path}`, text);
  for (const [path, text] of files) { mkdirSync(dirname(join(root,path)),{recursive:true}); writeFileSync(join(root,path),text); }
  return { root, files };
}

test('identified source seeds preserve every external resolution across dev, alpha, beta and stable preparation', () => {
  for (const next of ['3.0.1-dev', '3.0.0-alpha.1', '3.0.0-beta.2', '3.0.0-rc.1', '3.0.0', '3.1.0']) {
    const output = prepareTemplateSeeds(ROOT, version, next);
    assert.equal(output.size, 9);
    for (const [template, before] of originals) {
      const after = new Map([...before].map(([path]) => [path, output.get(`packages/create-app/templates/${template}/${path}`)]));
      validateSeedFiles(after,next,template);
      assert.deepEqual(externalNpm(after),externalNpm(before));
      assert.deepEqual(externalCargo(after),externalCargo(before));
    }
    assert.equal(JSON.parse(versionFiles(ROOT,next).get(SEED_MARKER)).version,next);
  }
  assert.deepEqual(readTemplateSeeds(ROOT, version), originals, 'preparation stays pure');
});

test('prepared source seeds remain preparable after alpha, beta and stable versions are written', () => {
  const {root} = isolated();
  try {
    let prior = version;
    for (const next of ['3.0.0-alpha.1','3.0.0-beta.2','3.0.0','3.1.0-dev']) {
      const files = prepareTemplateSeeds(root,prior,next);
      for (const [path,text] of files) writeFileSync(join(root,path),text);
      writeFileSync(join(root,'packages/create-app/package.json'), JSON.stringify({version:next}));
      readTemplateSeeds(root,next); prior = next;
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('source seeds reject missing or malformed external npm and Cargo hashes', () => {
  for (const integrity of [undefined, 'sha512-invalid']) assert.throws(changed('minimal', files => npm(files, lock => {
    const path = Object.keys(externalNpm(files))[0];
    if(integrity === undefined) delete lock.packages[path].integrity; else lock.packages[path].integrity = integrity;
  })), /external npm checksum/);
  for (const checksum of ['', 'checksum = "invalid"\n']) assert.throws(changed('minimal', files => cargo(files, text => text.replace(/^checksum = "[a-f0-9]+"\n/m, checksum))), /external crate checksum/);
});

test('bundled entries must belong to an authenticated external parent archive', () => {
  validateSeedFiles(originals.get('dashboard'), version, 'dashboard');
  assert.throws(changed('dashboard', files => npm(files, lock => {
    const path = Object.keys(lock.packages).find(p => lock.packages[p].inBundle);
    delete lock.packages[path.slice(0,path.lastIndexOf('/node_modules/'))].integrity;
  })), /checksum/);
  assert.throws(changed('minimal', files => npm(files, lock => { lock.packages['node_modules/forged'] = {version:'1.0.0',inBundle:true}; })), /unproven bundled/);
});

test('source seeds refuse unknown or mixed internal npm packages and requirements', () => {
  for (const change of [
    lock => {lock.packages['node_modules/@getforma/core'].version = mismatchedVersion;},
    lock => {lock.packages['node_modules/@getforma/core'].integrity = 'sha512-'+'A'.repeat(86)+'==';},
    lock => {lock.packages['node_modules/@getforma/unknown'] = lock.packages['node_modules/@getforma/core'];},
    lock => {lock.packages['node_modules/@getforma/compiler'].peerDependencies['@getforma/core'] = '^2.0.0';},
    lock => {lock.packages['node_modules/@getforma/build'].dependencies['@getforma/unknown'] = '=3.0.0-dev';},
    lock => {delete lock.packages['node_modules/@getforma/core'];},
  ]) assert.throws(changed('minimal',files => npm(files,change)), /internal|authenticate/);
  assert.throws(changed('minimal',files => {
    const p=JSON.parse(files.get('admin/package.json'));p.dependencies['@getforma/core']='='+mismatchedVersion;files.set('admin/package.json',JSON.stringify(p));
  }), /mixed internal requirement/);
});

test('source seeds refuse unknown crates, mixed versions, stale internal hashes and invalid graph edges', () => {
  for (const change of [
    text => text.replace('name = "forma-ir"','name = "forma-unknown"'),
    text => text.replace('name = "forma-ir"\nversion = "'+version+'"','name = "forma-ir"\nversion = "'+mismatchedVersion+'"'),
    text => text.replace('name = "forma-ir"','name = "forma-ir"\nchecksum = "'+'a'.repeat(64)+'"'),
    text => text.replace(' "forma-ir",',' "missing-crate",'),
  ]) assert.throws(changed('minimal',files => cargo(files,change)), /internal|authenticate|crate|dependency|Cargo edge/);
});

test('seed identity and both templates are validated before staging writes or archive access', () => {
  const packages = ['forma-ir','forma-ir-derive','forma-server','@getforma/core','@getforma/compiler','@getforma/build'].map(name=>({name,version,registry:name.startsWith('@')?'npm':'crates'}));
  for (const fault of ['missing-marker','unknown-template','mixed-marker','mixed-candidate','missing-external','missing-internal']) {
    const {root,files}=isolated();
    try {
      let candidate=packages;
      if(fault==='missing-marker') {rmSync(join(root,SEED_MARKER));files.delete(SEED_MARKER);}
      if(fault==='unknown-template'||fault==='mixed-marker') {
        const marker=JSON.parse(files.get(SEED_MARKER)); if(fault==='unknown-template')marker.templates.push('unknown');else marker.version=mismatchedVersion;
        files.set(SEED_MARKER,JSON.stringify(marker));writeFileSync(join(root,SEED_MARKER),files.get(SEED_MARKER));
      }
      if(fault==='mixed-candidate')candidate=packages.map((p,i)=>i?p:{...p,version:mismatchedVersion});
      if(fault==='missing-external'||fault==='missing-internal') {
        const path='packages/create-app/templates/dashboard/admin/package-lock.json';const lock=JSON.parse(files.get(path));
        if(fault==='missing-internal')delete lock.packages['node_modules/@getforma/core'];else delete lock.packages['node_modules/esbuild'].integrity;
        files.set(path,JSON.stringify(lock));writeFileSync(join(root,path),files.get(path));
      }
      assert.throws(()=>stageTemplates(root,candidate,root),/identity|version|checksum|omits/);
      for(const [path,text]of files) assert.equal(readFileSync(join(root,path),'utf8'),text,`${fault}: ${path}`);
    }finally{rmSync(root,{recursive:true,force:true});}
  }
});
