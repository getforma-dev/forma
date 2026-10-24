import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
const server=process.env.GP_ISLAND_TARGET==='server';
export default defineConfig({
 plugins:[preact()], define:{'process.env.NODE_ENV':'"production"'}, ssr:{noExternal:true},
 build:{ssr:server ? 'src/island-server.jsx' : false, outDir:'dist', emptyOutDir:false,
 rollupOptions:{input:server ? undefined : 'src/island-client.jsx', output:{entryFileNames:server ? 'island-server.mjs' : 'island-client.js', inlineDynamicImports:true}}}
});
