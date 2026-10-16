import {it,expect,vi,afterEach} from 'vitest';
import {resolve} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {parseOpcodeList} from './helpers/fmir';
afterEach(()=>vi.restoreAllMocks());

it('emits the actual typed 200/2000 product fixture with two authentic indexed instances',()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const result=generateRealIr(resolve(__dirname,'../../../e2e/ssr/cases/keyed-indexed/app.tsx'))!;
 expect(result.islands.map(island=>island.name)).toEqual(['IndexedRows','IndexedRows']);
 expect(parseOpcodeList(result.binary).filter(op=>op.startsWith('LIST '))).toHaveLength(2);
});
