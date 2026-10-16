import { defineConfig } from '@playwright/test';

// The source R17 lane still runs this spec in Chromium through the root config.
// This focused qualification uses its existing static fixture server and needs
// no unrelated SSR/native products. Refuse an existing listener in every engine.
const port = Number(process.env.FORMA_STATIC_E2E_PORT ?? 3457);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid FORMA_STATIC_E2E_PORT');

export default defineConfig({
  testDir: '.',
  testMatch: 'full-stack.spec.ts',
  timeout: 15_000,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, headless: true },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
  })),
  webServer: {
    command: `node ../node_modules/serve/build/main.js fixtures -l ${port} --no-clipboard`,
    port,
    reuseExistingServer: false,
  },
});
