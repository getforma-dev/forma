import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
export default defineConfig({
  output: 'server',
  integrations: [react()],
  adapter: node({ mode: 'standalone' }),
  server: { host: '0.0.0.0', port: 3000 },
  devToolbar: { enabled: false },
  telemetry: false,
});
