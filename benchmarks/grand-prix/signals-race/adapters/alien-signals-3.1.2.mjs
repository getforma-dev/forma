// Reference for the version check: the alien-signals copy @getforma/core 3.0.0 itself resolves (3.1.2),
// so Forma's own layer can be told apart from the version gap to the raced reference (3.2.1). Not scored.
import { signal, computed, effect, startBatch, endBatch } from '../node_modules/@getforma/core/node_modules/alien-signals/esm/index.mjs';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../node_modules/@getforma/core/node_modules/alien-signals/package.json', import.meta.url), 'utf8'));

export default {
  name: 'alien-signals',
  version: pkg.version,
  signal(v) { const s = signal(v); return { get: () => s(), set: (x) => s(x) }; },
  computed(fn) { const c = computed(fn); return { get: () => c() }; },
  effect(fn) { return effect(fn); },
  batch(fn) { startBatch(); try { fn(); } finally { endBatch(); } },
};
