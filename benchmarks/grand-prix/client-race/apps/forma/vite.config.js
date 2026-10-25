import { defineConfig } from 'vite';
import { compilerPlugin } from '../../compiler-plugin.mjs';
const compiler = await compilerPlugin(process.env.GP_FORMA_COMPILER, process.env.GP_TEMPLATE_EVIDENCE);
export default defineConfig({
  base: './',
  plugins: compiler ? [compiler] : [],
  esbuild: { jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment' },
  build: { outDir: 'dist', emptyOutDir: true },
});
