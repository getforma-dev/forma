// Post-build gate only. The pure validator suite needs no built artifacts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyDecoderCompiler} from './release-performance-decoder.mjs';

test('the actual candidate compiler regenerates the frozen source/IR/registration proof',async()=>{
  const compiler=await verifyDecoderCompiler(fileURLToPath(new URL('../packages/compiler/',import.meta.url)));
  assert.match(compiler.sha256,/^[a-f0-9]{64}$/);
  assert.equal(compiler.fixtures.length,2);
});
