import {defineConfig} from '@playwright/test';
import {SSR_ORIGIN,SSR_PORT} from './origin';
export default defineConfig({
  testDir:'.',testMatch:['regressions.spec.ts','sanitized-controls.spec.ts'],timeout:30_000,retries:0,
  use:{baseURL:SSR_ORIGIN,headless:true},
  projects:['chromium','firefox','webkit'].map(browserName=>({name:browserName,use:{browserName:browserName as 'chromium'|'firefox'|'webkit'}})),
  webServer:{command:`node serve.mjs ${SSR_PORT}`,url:`${SSR_ORIGIN}/__site`,reuseExistingServer:false},
});
