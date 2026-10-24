import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  esbuild: { jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment' },
  build: { outDir: 'dist', emptyOutDir: true },
});
