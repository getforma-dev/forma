import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
const server=process.env.GP_ISLAND_TARGET==='server';
export default defineConfig({
 plugins:[vue()], define:{'process.env.NODE_ENV':'"production"'}, ssr:{noExternal:true},
 build:{ssr:server ? 'src/island-server.mjs' : false, outDir:'dist', emptyOutDir:false,
 rollupOptions:{input:server ? undefined : 'src/island-client.mjs', output:{entryFileNames:server ? 'island-server.mjs' : 'island-client.js', inlineDynamicImports:true}}}
});
