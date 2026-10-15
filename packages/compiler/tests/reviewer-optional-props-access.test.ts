import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';

it('admits the documented optional props access when the declared root is always present',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forma-review-optional-props-'));
  try {
    writeFileSync(join(dir,'app.ts'),`import {mount,activateIslands} from '@getforma/core';import {Page} from './page';import {Badge} from './island';activateIslands({Badge});mount(()=>Page(),'#app');`);
    writeFileSync(join(dir,'page.ts'),`import {h} from '@getforma/core';import {Badge} from './island';export function Page(){return h('main',null,Badge({count:1001}));}`);
    writeFileSync(join(dir,'island.ts'),`import {h,createSignal} from '@getforma/core';export function Badge(props:{count?:number}){const[n]=createSignal(props?.count??42);return h('b',null,n);}`);
    expect(generateRealIr(join(dir,'app.ts'))).not.toBeNull();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
