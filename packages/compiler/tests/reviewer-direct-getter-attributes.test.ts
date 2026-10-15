import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {getSlots} from './helpers/fmir';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function pair(tag:string,attribute:string,initial:string,captured=false){
  const root=mkdtempSync(join(tmpdir(),'forma-direct-getter-'));roots.push(root);
  const entry=join(root,'app.ts'),island=join(root,'island.ts');
  writeFileSync(entry,`import {h,mount,activateIslands} from '@getforma/core';import {Area} from './island';function Page(){return h('main',null,Area())};activateIslands({Area});mount(Page,'#app');`);
  const declaration=`const [value]=createSignal(${initial});`;
  const source=(value:string)=>`import {h,createSignal} from '@getforma/core';${captured?declaration:''}export function Area(){${captured?'':declaration}return h('${tag}',{${attribute}:${value}});}`;
  writeFileSync(island,source('value'));
  const direct=generateRealIr(entry)!;
  writeFileSync(island,source('()=>value()'));
  const arrow=generateRealIr(entry)!;
  return {direct,arrow};
}
describe('independent direct getter attribute production',()=>{
  it.each([
    ['textarea','value',"'server'"],
    ['input','checked','true'],
    ['input','value','42'],
    ['div','title',"'server'"],
  ])('uses the actual local signal slot for %s %s', (tag,attribute,initial)=>{
    const {direct,arrow}=pair(tag,attribute,initial);
    expect(direct.islands[0]!.contract).toEqual(arrow.islands[0]!.contract);
    expect(Buffer.from(direct.binary)).toEqual(Buffer.from(arrow.binary));
    expect(getSlots(direct.binary).map(slot=>slot.name)).not.toContain(`attr:${attribute}`);
  });
  it('retains the same captured module signal identity as an explicit reader',()=>{
    const {direct,arrow}=pair('textarea','value',"'captured'",true);
    expect(direct.islands[0]!.contract).toEqual(arrow.islands[0]!.contract);
    expect(Buffer.from(direct.binary)).toEqual(Buffer.from(arrow.binary));
  });
});
