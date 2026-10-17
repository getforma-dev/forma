import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
it.each(['{}','{count:null}','{count:0}'])('emits a native island default for closed input %s', args => {
 const dir=mkdtempSync(join(tmpdir(),'forma-review-default-'));
 try {
  writeFileSync(join(dir,'app.ts'),`import {mount,activateIslands} from '@getforma/core';import {Page} from './page';import {Badge} from './island';activateIslands({Badge});mount(()=>Page(),'#app');`);
  writeFileSync(join(dir,'page.ts'),`import {h} from '@getforma/core';import {Badge} from './island';export function Page(){return h('main',null,Badge(${args}));}`);
  writeFileSync(join(dir,'island.ts'),`import {h,createSignal} from '@getforma/core';export function Badge(p:{count?:number}){const[n,setN]=createSignal(p.count??42);return h('b',null,n);}`);
  const result=generateRealIr(join(dir,'app.ts'));
  expect(result).not.toBeNull();
  const out=join(dir,'outputs');mkdirSync(out,{recursive:true});
  writeFileSync(join(out,args==='{}'?'omitted.ir':args.includes('null')?'null.ir':'zero.ir'),result!.binary);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
