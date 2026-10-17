// NEVER MERGE. Three fixed serial arms; Playwright owns each page and serve.mjs.
import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
import { SSR_ORIGIN, SSR_PORT } from './origin';
const outputRoot = resolve(__dirname, '../../test-results/indexed-null');
export default defineConfig({
  testDir: '.', testMatch: 'indexed-diagnostic.spec.ts', workers: 1, fullyParallel: false,
  timeout: 165_000, globalTimeout: 540_000, retries: 0,
  use: { baseURL: SSR_ORIGIN, browserName: 'chromium', headless: true, viewport: { width: 1280, height: 720 } },
  reporter: [['list'], ['json', { outputFile: join(outputRoot, 'playwright.json') }]],
  outputDir: join(outputRoot, 'arms'),
  webServer: { command: `node serve.mjs ${SSR_PORT}`, url: `${SSR_ORIGIN}/__site`, reuseExistingServer: false },
});
