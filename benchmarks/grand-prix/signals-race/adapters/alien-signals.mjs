import { signal, computed, effect, startBatch, endBatch } from 'alien-signals';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../node_modules/alien-signals/package.json', import.meta.url), 'utf8'));

export default {
  name: 'alien-signals',
  version: pkg.version,
  signal(v) { const s = signal(v); return { get: () => s(), set: (x) => s(x) }; },
  computed(fn) { const c = computed(fn); return { get: () => c() }; },
  effect(fn) { return effect(fn); },
  batch(fn) { startBatch(); try { fn(); } finally { endBatch(); } },
};
