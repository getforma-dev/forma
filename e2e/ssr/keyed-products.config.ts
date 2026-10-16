import { defineConfig } from '@playwright/test';
import { SSR_ORIGIN, SSR_PORT } from './origin';

// FORMA-181 D's actual compiler/native/browser product, after build.sh.
// The ordinary source lane also runs these checks in Chromium via the root config.
export default defineConfig({
  testDir: '.',
  testMatch: 'regressions.spec.ts',
  grep: /keyed-moves/,
  timeout: 30_000,
  retries: 0,
  use: { baseURL: SSR_ORIGIN, headless: true },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `node serve.mjs ${SSR_PORT}`,
    url: `${SSR_ORIGIN}/__site`,
    reuseExistingServer: false,
  },
});
