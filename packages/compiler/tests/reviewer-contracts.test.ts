import { expect, it } from 'vitest';
import { canonicalIslandSchema, encodeBindings, encodeClosedConstant, type BindingRecord } from '../src/fmir-contracts.js';
import type { PropsSchema, SchemaType } from '../src/fmir-payload.js';

const field = (name: string, type: SchemaType) => ({name,type,file:'review.tsx',line:1,column:1});
it('keeps a repeated shared schema compact and independent of global numbering', () => {
  const shared: PropsSchema = Array.from({length:32},(_,i) => i===31 ? [field('value',{kind:'number'})] : [field('left',{kind:'object',object:i+1}),field('right',{kind:'object',object:i+1})]);
  const reversed: PropsSchema = [...shared].reverse().map(fields=>fields.map(f=>f.type.kind==='object' ? {...f,type:{kind:'object' as const,object:31-f.type.object}} : f));
  const a=canonicalIslandSchema(shared,0), b=canonicalIslandSchema(reversed,31);
  expect(a.objects).toHaveLength(32);
  expect(a.bytes.length).toBeLessThan(1000);
  expect(a.bytes).toEqual(b.bytes);
});
it('keeps branch-local signal ordinals separate while admitting the later dominating signal', () => {
  const seed: BindingRecord = {kind:'signal',value:{kind:'constant',value:1}};
  const branches: BindingRecord = {kind:'show',value:{kind:'constant',value:true},then:[seed],else:[seed]};
  const read = (id:number): BindingRecord => ({kind:'text',value:{kind:'signal',id,path:[]}});
  const good=encodeBindings('ssr',[branches,seed,read(2)]);
  expect(good.slice(0,4)).toEqual(Uint8Array.of(1,0,3,0));
  expect(()=>encodeBindings('ssr',[branches,seed,read(0)])).toThrow(/does not dominate/);
  expect(()=>encodeBindings('ssr',[branches,seed,read(1)])).toThrow(/does not dominate/);
});
it('preserves closed constant null keys before projection and generic finite f64 provenance', () => {
  const constant=JSON.parse('{"constructor":null}');
  expect(Buffer.from(encodeClosedConstant(constant)).toString('hex')).toBe('0601000b00636f6e7374727563746f7200');
  const encoded=encodeClosedConstant(2**53);
  expect(encoded[0]).toBe(3);
  expect(new DataView(encoded.buffer,encoded.byteOffset+1,8).getFloat64(0,true)).toBe(2**53);
});
