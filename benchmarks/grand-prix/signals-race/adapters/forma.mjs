import { createSignal, createComputed, createEffect, batch } from '@getforma/core';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../node_modules/@getforma/core/package.json', import.meta.url), 'utf8'));

export default {
  name: 'forma',
  version: pkg.version,
  signal(v) { const [get, set] = createSignal(v); return { get, set }; },
  computed(fn) { return { get: createComputed(fn) }; },
  effect(fn) { return createEffect(fn); },
  batch(fn) { batch(fn); },
};
