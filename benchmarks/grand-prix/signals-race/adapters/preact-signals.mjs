import { signal, computed, effect, batch } from '@preact/signals-core';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../node_modules/@preact/signals-core/package.json', import.meta.url), 'utf8'));

export default {
  name: 'preact-signals',
  version: pkg.version,
  signal(v) { const s = signal(v); return { get: () => s.value, set: (x) => { s.value = x; } }; },
  computed(fn) { const c = computed(fn); return { get: () => c.value }; },
  effect(fn) { return effect(fn); },
  batch(fn) { batch(fn); },
};
