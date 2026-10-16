import { defineConfig } from '@playwright/test';
import { SSR_ORIGIN, SSR_PORT } from './origin';
// Run after the production-profile typed SSR build. No retries conceal timing
// or correctness failures; evidence includes every measured sample.
export default defineConfig({
  testDir: '.', testMatch: 'indexed-products.spec.ts', timeout: 60_000, retries: 0,
  use: { baseURL: SSR_ORIGIN, headless: true },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { command: `node serve.mjs ${SSR_PORT}`, url: `${SSR_ORIGIN}/__site`, reuseExistingServer: false },
});
