import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  define: { 'process.env.NODE_ENV': '"production"' },
  ssr: { noExternal: true },
  build: {
    ssr: 'src/server.mjs',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
});
