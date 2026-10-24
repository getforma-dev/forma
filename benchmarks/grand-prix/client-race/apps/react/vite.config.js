import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  build: { outDir: 'dist', emptyOutDir: true },
});
