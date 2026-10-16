import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';

test('actual decoder boot includes deferred entry time and retains delivered mutation records', async () => {
  const source = readFileSync(new URL('./release-performance-decoder.mjs', import.meta.url), 'utf8');
  const boot = source.match(/  const boot = `([\s\S]*?)`;\n  const server=/)?.[1];
  assert(boot, 'actual producer boot must remain available to the behavioral control');
  let time = 0, observer;
  const context = {
    window: {}, performance: {now: () => time}, TextEncoder, Uint8Array, crypto: webcrypto,
    console: {error() {}}, setTimeout,
    document: {addEventListener() {}, querySelector: () => ({getAttribute: () => 'pending'}), querySelectorAll: () => [{}]},
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {} takeRecords() { return [{type: 'attributes'}]; } disconnect() {}
    },
    __islandRegistration: component => component, h: () => undefined,
    activateIslands: async registry => {
      await Promise.resolve(); time = 17; registry.Decoder({value: 'observed'});
      observer.callback([{type: 'childList'}]);
      await Promise.resolve(); time = 40;
    },
  };
  runInNewContext(boot.replace(/^import[^;]+;/, ''), context);
  const result = await context.window.runDecoder({});
  assert.equal(result.calls, 1);
  assert.equal(result.elapsedMs, 17, 'end stays at first component entry, not promise completion');
  assert.equal(result.mutations, 2, 'delivered and still-pending records both remain evidence');
  assert.equal(result.valueLength, 8);
});
