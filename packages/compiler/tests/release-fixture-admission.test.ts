import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {collectDiagnostics} from '../src/diagnostics';
const root=join(__dirname,'../../..');
const cases=join(root,'e2e/ssr/cases');
const archive=join(root,'docs/archive/FORMA-139-e2e-title');
describe('R17 SSR fixture admission',()=>{
 for(const name of readdirSync(cases).sort())it(`${name} remains in the strict native subset`,()=>{
  const {result,diagnostics}=collectDiagnostics(()=>generateRealIr(join(cases,name,'app.tsx')));
  expect(diagnostics).toEqual([]);expect(result?.binary.length).toBeGreaterThan(0);
 });
 it('retains the original component title as an explicit BUILD-619 refusal',()=>{
  let failure:unknown;
  const {result,diagnostics}=collectDiagnostics(()=>{try{return generateRealIr(join(archive,'e2e/ssr/cases/title/app.tsx'));}catch(error){failure=error;return null;}});
  expect(result).toBeNull();expect(failure).toMatchObject({code:'BUILD-619'});
  expect(diagnostics).toEqual([expect.objectContaining({code:'BUILD-619',line:15,column:9})]);
 });
 it('authenticates the original title fixture, renderer, assertions and CI failure',()=>{
  const manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8'));
  for(const [name,sha] of Object.entries(manifest.files))expect(createHash('sha256').update(readFileSync(join(archive,name))).digest('hex'),name).toBe(sha);
 });
});
