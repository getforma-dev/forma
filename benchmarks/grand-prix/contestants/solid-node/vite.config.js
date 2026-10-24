import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid({ ssr: true, solid: { hydratable: false } })],
  define: { 'process.env.NODE_ENV': '"production"' },
  ssr: { noExternal: true },
  build: {
    ssr: 'src/server.mjs',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
});
