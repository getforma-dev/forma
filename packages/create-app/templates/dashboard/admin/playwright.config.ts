import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'cd .. && cargo run',
    port: 3000,
    timeout: 120000,
    reuseExistingServer: true,
  },
});
