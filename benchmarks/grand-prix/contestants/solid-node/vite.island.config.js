import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
const server=process.env.GP_ISLAND_TARGET==='server';
export default defineConfig({
 plugins:[solid({ ssr:true, solid:{hydratable:true} })], define:{'process.env.NODE_ENV':'"production"'}, ssr:{noExternal:true},
 build:{ssr:server ? 'src/island-server.jsx' : false, outDir:'dist', emptyOutDir:false,
 rollupOptions:{input:server ? undefined : 'src/island-client.jsx', output:{entryFileNames:server ? 'island-server.mjs' : 'island-client.js', inlineDynamicImports:true}}}
});
