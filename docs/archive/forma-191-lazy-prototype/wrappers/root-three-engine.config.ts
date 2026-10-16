import base from './forma/playwright.config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'forma');
export default {
  ...base,
  testDir: join(root, 'e2e'),
  testMatch: ['fixtures/apps/apps.spec.ts', 'ssr/namespaces.spec.ts'],
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: { browserName },
  })),
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer]).map(server => ({
    ...server,
    cwd: root,
  })),
};
