/** The narrowing preserves original executable inputs and authenticates each regenerated product. */
import {afterEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
const root=resolve(__dirname,'../../..'), archive=join(root,'docs/archive/FORMA-101-unproved-list-sources');
const hash=(bytes:Buffer)=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
afterEach(()=>vi.restoreAllMocks());
it('keeps the original source, test and wire evidence byte-exact, and pins every live migration',()=>{
 const manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8'));
 const ledger=JSON.parse(readFileSync(join(archive,'ledger.json'),'utf8'));
 for(const [name,expected] of Object.entries(manifest.sha256))expect(hash(readFileSync(join(archive,name))),name).toEqual(expected);
 for(const [name,entry] of Object.entries(ledger.files) as [string,any][]){
  expect(entry.before,name).toEqual(manifest.sha256[entry.archived]);
  expect(hash(readFileSync(join(root,name))),name).toEqual(entry.after);
 }
});
it('the original callable-but-empty corpus source now refuses with the native contract code',()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 expect(()=>generateRealIr(join(archive,'packages/compiler/tests/fixtures/ir-corpus/list-same-source/app.ts'))).toThrow(/BUILD-610.*declared array prop or a closed literal-default signal/);
});
