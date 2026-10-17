import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { analyzeIslandBindings } from '../src/island-bindings';
it('retains the preserved imported static-map island corpus', () => {
 const file=fileURLToPath(new URL('./fixtures/ir-corpus/imported-const-table/picker.ts', import.meta.url));
 expect(()=>analyzeIslandBindings(readFileSync(file,'utf8'),file,'KeyPicker',{
  props:[],loadModule(from,spec){
   if(!spec.startsWith('.')) return undefined;
   const stem=resolve(dirname(from),spec),path=[stem+'.ts',stem+'.tsx',resolve(stem,'index.ts')].find(existsSync);
   return path?{path,source:readFileSync(path,'utf8')}:undefined;
  }
 })).not.toThrow();
});
