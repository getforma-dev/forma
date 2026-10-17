// NEVER MERGE. Three fixed serial arms; Playwright owns each page and serve.mjs.
import { defineConfig } from '@playwright/test';
import { SSR_ORIGIN, SSR_PORT } from './origin';
export default defineConfig({
  testDir: '.', testMatch: 'indexed-diagnostic.spec.ts', workers: 1, fullyParallel: false,
  timeout: 165_000, globalTimeout: 540_000, retries: 0,
  use: { baseURL: SSR_ORIGIN, browserName: 'chromium', headless: true, viewport: { width: 1280, height: 720 } },
  reporter: [['list'], ['json', { outputFile: 'test-results/indexed-null/playwright.json' }]],
  outputDir: 'test-results/indexed-null/arms',
  webServer: { command: `node serve.mjs ${SSR_PORT}`, url: `${SSR_ORIGIN}/__site`, reuseExistingServer: false },
});
