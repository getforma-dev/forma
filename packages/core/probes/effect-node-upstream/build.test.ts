// Pinned upstream build controls with only installed-package import paths changed.
import { expect, test } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
test('build: cjs', () => {
  const index = require('alien-signals/cjs');
  const system = require('alien-signals/cjs/system');
  expect(typeof index.getActiveSub).toBe('function');
  expect(typeof system.createReactiveSystem).toBe('function');
});
test('build: esm', async () => {
  const index = await import('alien-signals/esm');
  const system = await import('alien-signals/esm/system');
  expect(typeof index.getActiveSub).toBe('function');
  expect(typeof system.createReactiveSystem).toBe('function');
});
