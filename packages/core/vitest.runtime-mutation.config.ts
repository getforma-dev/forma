import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Preserve full expected/actual assertion text for the named-kill classifier.
// No production behavior, selected tests or assertion semantics are changed.
export default mergeConfig(base, defineConfig({
  test: { chaiConfig: { truncateThreshold: 0 } },
}));
