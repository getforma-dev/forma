import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NPM_PACKAGES, CRATE_PACKAGES, ROUTER_PACKAGE_SET, npmPackagesForVersion, packageIdentitiesForVersion, candidateNpmPackages } from './release-package-inventory.mjs';
import { ROOT, versionFiles, assertReleaseSet, json } from './release-set.mjs';
import { readRecordedSet } from './release-support.mjs';
import { join } from 'node:path';
const records = version => packageIdentitiesForVersion(version).map(identity => {
  const [registry,name]=identity.split(':'); return {registry,name,version,sha256:'a'.repeat(64)};
});
test('source builds and packs five npm packages with router before the CLI',()=>{
  assert.deepEqual(NPM_PACKAGES,['core','compiler','build','router','create-app']);
  assert.equal(CRATE_PACKAGES.length,3);
  const root=json(join(ROOT,'package.json')),lock=json(join(ROOT,'package-lock.json'));
  assert.deepEqual(new Set(root.workspaces),new Set(NPM_PACKAGES.map(name=>`packages/${name}`)));
  for(const name of NPM_PACKAGES)assert(lock.packages[`packages/${name}`],name);
  assert(root.scripts.build.indexOf('packages/core')<root.scripts.build.indexOf('packages/router'));
});
test('immutable 3.0 and 3.1 records retain seven packages; next minor requires router as eighth',()=>{
  for(const version of ['3.0.0','3.1.0','3.1.7-rc.1','3.2.0-alpha.1','3.2.0','4.0.0']){
    const packages=records(version), expected=/^3\.[01]\./.test(version)?7:8;
    assert.equal(packages.length,expected);assert.equal(assertReleaseSet(packages,`v${version}`),version);
    const record={schema:1,dryRun:false,tag:`v${version}`,commit:'b'.repeat(40),packages,measurements:{passed:true,commit:'b'.repeat(40)}};
    const read=value=>{const bytes=Buffer.from(JSON.stringify(value));return readRecordedSet(bytes,createHash('sha256').update(bytes).digest('hex'));};
    assert.deepEqual(read(record),record);
    const changed=structuredClone(record);
    if(expected===7)changed.packages.push({registry:'npm',name:'@getforma/router',version,sha256:'a'.repeat(64)});
    else changed.packages=changed.packages.filter(p=>p.name!=='@getforma/router');
    assert.throws(()=>read(changed),/inventory/);
  }
});
test('feature dry packs explicitly declare the new source inventory without rewriting historical version records',()=>{
  const set={packageSet:ROUTER_PACKAGE_SET,packages:[{version:'3.1.0'}]};
  assert.deepEqual(candidateNpmPackages(set),NPM_PACKAGES);
  assert.equal(candidateNpmPackages({packages:[{version:'3.1.0'}]}).length,4);
  assert.throws(()=>candidateNpmPackages({...set,packageSet:'unknown'}));
  assert(!npmPackagesForVersion('3.1.0').includes('router'));
});
test('next-minor version preparation updates router manifest and locked core peer without modifying source',()=>{
  const before=json(join(ROOT,'packages/router/package.json'));
  for(const version of ['3.2.0','3.2.0-rc.1']){
    const files=versionFiles(ROOT,version),manifest=JSON.parse(files.get('packages/router/package.json'));
    const lock=JSON.parse(files.get('package-lock.json')).packages['packages/router'];
    const peer=version.includes('-')?`^3.2.0 || =${version}`:'^3.2.0';
    assert.equal(manifest.version,version);assert.equal(lock.version,version);
    assert.equal(manifest.peerDependencies['@getforma/core'],peer);assert.equal(lock.peerDependencies['@getforma/core'],peer);
  }
  assert.deepEqual(json(join(ROOT,'packages/router/package.json')),before);
});
