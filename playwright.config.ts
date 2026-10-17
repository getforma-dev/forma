import { defineConfig } from '@playwright/test';
import { SSR_ORIGIN, SSR_PORT } from './e2e/ssr/origin';

const staticPort = Number(process.env.FORMA_STATIC_E2E_PORT ?? 3457);
if (!Number.isInteger(staticPort) || staticPort < 1 || staticPort > 65535) throw new Error('invalid FORMA_STATIC_E2E_PORT');

export default defineConfig({
  testDir: 'e2e',
  // Standalone node:test controls use *.test.mjs/*.test.mts and run in check.sh.
  // Playwright must collect only its browser specs, without importing Node suites.
  testMatch: '**/*.spec.ts',
  // The parity harness (FORMA-183) is a `node --test` suite with its own browser and its own
  // step in scripts/check.sh; its `*.test.mts` files are not Playwright tests.
  testIgnore: ['parity/**'],
  timeout: 15000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${staticPort}`,
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: `npx serve e2e/fixtures -l ${staticPort} --no-clipboard`,
      port: staticPort,
      reuseExistingServer: false,
    },
    // The SSR site built by e2e/ssr/build.sh (compiler + forma walker +
    // FormaJS), served with each page's own headers, for
    // e2e/ssr/regressions.spec.ts. Existing listeners are refused; the spec
    // also checks /__site names this clone's site. FORMA_SSR_E2E_PORT gives
    // parallel local checkouts independent ports.
    {
      command: `node e2e/ssr/serve.mjs ${SSR_PORT}`,
      url: `${SSR_ORIGIN}/__site`,
      reuseExistingServer: false,
    },
  ],
});
