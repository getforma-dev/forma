import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, run } from './release-set.mjs';
import { linkPackedPackages, assertPackedResolution } from './release-packed-resolution.mjs';
import { verifyPackedRouter } from './verify-release-set.mjs';

test('actual packed router resolves core/navigation from the packed core and matches retained owner branches', async t => {
  const scratch=mkdtempSync(join(ROOT,'.release-router-test-'));
  t.after(()=>rmSync(scratch,{recursive:true,force:true}));
  const archives=join(scratch,'archives');mkdirSync(archives);
  const packages=['core','router'].map(name=>({registry:'npm',name:`@getforma/${name}`,path:`packages/${name}`}));
  for(const item of packages){
    assert(existsSync(join(ROOT,item.path,'dist/index.js')), `${item.name}: build core and router before running the actual packed export control`);
    const info=JSON.parse(run('npm',['pack','--json','--ignore-scripts','--pack-destination',archives],join(ROOT,item.path)))[0];
    const destination=join(scratch,item.path);mkdirSync(destination,{recursive:true});
    run('tar',['-xzf',join(archives,info.filename),'-C',destination,'--strip-components=1']);
    assert.equal(JSON.parse(readFileSync(join(destination,'package.json'))).name,item.name);
  }
  linkPackedPackages(scratch,packages);
  const edges=assertPackedResolution(scratch,packages);
  assert(edges.some(edge=>edge.package==='@getforma/router'&&edge.specifier==='@getforma/core/navigation'));
  await verifyPackedRouter(scratch);
});
