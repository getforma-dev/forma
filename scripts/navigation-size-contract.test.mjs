import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationSizeVerdict} from './navigation-size-contract.mjs';
const input=(group,previous=20_000,current=20_000)=>({group,previousPlain:{'/a':previous,'/b':previous},currentPlain:{'/a':current,'/b':current}});
test('incremental router byte ceiling includes the new shared-core delta at below/equal/above12KiB',()=>{
  for(const delta of [12_287,12_288,12_289]){
    const result=navigationSizeVerdict(input(20_000+delta,20_000,21_000));
    assert.equal(result.incrementGzip,delta);assert.equal(result.comparisons[0].positiveSharedDeltaGzip,1000);
    assert.equal(result.passed,delta<=12_288);
  }
});
test('eager executable group ceiling holds at below/equal/above64KiB independently',()=>{
  for(const group of [65_535,65_536,65_537])assert.equal(navigationSizeVerdict(input(group,60_000,60_000)).passed,group<=65_536);
});
test('summing duplicate plain runtimes cannot hide a too-large cold group increment',()=>{
  const result=navigationSizeVerdict(input(33_000));
  assert.equal(result.incrementGzip,13_000);assert.equal(result.passed,false);
  assert.throws(()=>navigationSizeVerdict({...input(10),currentPlain:{'/a':20_000}}),/inventory/);
  assert.throws(()=>navigationSizeVerdict(input(-1)),/nonnegative/);
});
