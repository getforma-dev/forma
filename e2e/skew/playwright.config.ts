import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'skew.spec.ts', timeout: 120_000, retries: 0, workers: 2,
  use: { headless: true },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' } })),
});
