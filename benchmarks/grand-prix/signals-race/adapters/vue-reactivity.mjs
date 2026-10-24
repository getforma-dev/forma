// @vue/reactivity has no public batch: batch(fn) just calls fn, as the spec says.
import { ref, computed, effect, stop } from '@vue/reactivity';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../node_modules/@vue/reactivity/package.json', import.meta.url), 'utf8'));

export default {
  name: 'vue-reactivity',
  version: pkg.version,
  signal(v) { const r = ref(v); return { get: () => r.value, set: (x) => { r.value = x; } }; },
  computed(fn) { const c = computed(fn); return { get: () => c.value }; },
  effect(fn) { const runner = effect(fn); return () => stop(runner); },
  batch(fn) { fn(); },
  noBatch: true,
};
