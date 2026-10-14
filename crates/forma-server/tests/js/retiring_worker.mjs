// The retiring service worker, run in a stand-in ServiceWorkerGlobalScope
// (FORMA-130, DR-25, M25). Driven by `sw::tests::the_retiring_worker_deletes_v1_s_caches_and_its_own_never_another_s`
// in `src/sw.rs`, which writes the worker sources forma-server serves into
// FORMA_RETIRING_UNNAMED and FORMA_RETIRING_LEDGER and runs `node --test` on
// this file. Node 18 or later; no packages.
//
// CACHE_VECTORS is the per-application cache-name contract as data: which
// names a retiring worker for no application, and for "ledger", deletes.
// The build's production worker (forma-tools, the build half of FORMA-130)
// follows the same table for its own activation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const UNNAMED = process.env.FORMA_RETIRING_UNNAMED;
const LEDGER = process.env.FORMA_RETIRING_LEDGER;

// [cache name, deleted by the unnamed retiring worker, deleted by ledger's]
export const CACHE_VECTORS = [
  // v1 and build 0.3.0 names: Forma's, unattributable, retired by every app.
  ['forma-dev', true, true],
  ['forma-0123456789ab', true, true],
  ['forma-0123456789ab-on-demand-v1', true, true],
  // ledger's own caches under the per-application contract.
  ['forma:ledger:0123456789ab', false, true],
  ['forma:ledger:fedcba987654', false, true],
  // another application's: never.
  ['forma:other:0123456789ab', false, false],
  ['forma:ledgers:0123456789ab', false, false], // a prefix of the name is not the name
  ['forma:ledger', false, false], // no build segment: not a cache this contract writes
  // near misses of the v1 shape: not Forma's v1 names.
  ['forma-0123456789AB', false, false],
  ['forma-0123456789abc', false, false],
  ['forma-0123456789a', false, false],
  ['forma-notes', false, false],
  ['forma-', false, false],
  ['forma-dev-extra', false, false],
  // unrelated caches on the origin.
  ['my-app-data', false, false],
  ['workbox-precache-v2-https://example.com/', false, false],
];

/** Load a worker source into a fresh stand-in scope holding `cacheNames`. */
function load(source, cacheNames, { keysThrow = false } = {}) {
  const listeners = {};
  const names = new Set(cacheNames);
  const log = { skipWaiting: 0, unregister: 0, claim: 0, deleted: [] };
  const scope = {
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener);
    },
    skipWaiting: async () => {
      log.skipWaiting += 1;
    },
    registration: {
      unregister: async () => {
        log.unregister += 1;
        return true;
      },
    },
    clients: {
      claim: async () => {
        log.claim += 1;
      },
    },
    caches: {
      keys: async () => {
        if (keysThrow) throw new Error('storage unavailable');
        return [...names];
      },
      delete: async (name) => {
        log.deleted.push(name);
        return names.delete(name);
      },
    },
  };
  scope.self = scope;
  vm.runInNewContext(source, scope);
  return { listeners, names, log };
}

/** Fire `type` the way a browser does, and wait for its waitUntil promises. */
async function fire(worker, type) {
  const pending = [];
  for (const listener of worker.listeners[type] ?? []) {
    listener({ waitUntil: (promise) => pending.push(promise) });
  }
  await Promise.all(pending);
}

test('both sources were handed over', () => {
  assert.ok(UNNAMED && UNNAMED.length > 100, 'FORMA_RETIRING_UNNAMED');
  assert.ok(LEDGER && LEDGER.length > 100, 'FORMA_RETIRING_LEDGER');
});

for (const [label, source, column] of [
  ['unnamed', UNNAMED, 1],
  ['ledger', LEDGER, 2],
]) {
  test(`${label}: activation deletes exactly the contract's names, then unregisters`, async () => {
    const all = CACHE_VECTORS.map((row) => row[0]);
    const worker = load(source, all);
    await fire(worker, 'install');
    assert.equal(worker.log.skipWaiting, 1, 'it takes over at once: it serves nothing');
    await fire(worker, 'activate');

    const expected = CACHE_VECTORS.filter((row) => row[column]).map((row) => row[0]);
    assert.deepEqual([...worker.log.deleted].sort(), [...expected].sort());
    const kept = CACHE_VECTORS.filter((row) => !row[column]).map((row) => row[0]);
    assert.deepEqual([...worker.names].sort(), [...kept].sort());
    assert.equal(worker.log.unregister, 1);
    assert.equal(worker.log.claim, 0, 'it claims no tab');
  });

  test(`${label}: it answers no request, so pages load from the network`, () => {
    const worker = load(source, []);
    assert.equal(worker.listeners.fetch, undefined);
    assert.deepEqual(Object.keys(worker.listeners).sort(), ['activate', 'install']);
  });

  test(`${label}: with storage unavailable it still unregisters`, async () => {
    const worker = load(source, ['forma-dev'], { keysThrow: true });
    await fire(worker, 'activate');
    assert.equal(worker.log.unregister, 1);
    assert.deepEqual(worker.log.deleted, []);
  });
}
