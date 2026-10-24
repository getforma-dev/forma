// solid-js browser build: the server build has no reactivity.
import { createSignal, createMemo, createEffect, createRoot, batch } from 'solid-js/dist/solid.js';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../node_modules/solid-js/package.json', import.meta.url), 'utf8'));

export default {
  name: 'solid',
  version: pkg.version,
  // Default equality (===), like the other libraries. A function value would need the updater form, so wrap it.
  signal(v) { const [get, set] = createSignal(v); return { get, set: (x) => set(() => x) }; },
  computed(fn) { return { get: createMemo(fn) }; },
  effect(fn) {
    // A Solid effect lives in an owner; the root's dispose stops it.
    return createRoot((dispose) => { createEffect(fn); return dispose; });
  },
  batch(fn) { batch(fn); },
};
