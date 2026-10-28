import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const srcDirWithSlash = `${srcDir}/`;

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // Node 26 exposes native storage globals that shadow Happy DOM's Storage.
    // Browser tests need the DOM implementation; the Node engine-probe config
    // intentionally keeps the host's globals unchanged.
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/__tests__/**',
      ],
    },
  },
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxDev: false,
  },
  resolve: {
    alias: [
      { find: /^forma\/(.*)$/, replacement: `${srcDirWithSlash}$1` },
      { find: 'forma', replacement: srcDir },
    ],
  },
});
