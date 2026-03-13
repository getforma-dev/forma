import { build } from '@getforma/build';

await build({
  entryPoints: [
    { entry: 'src/home/app.ts', outfile: 'home.js' },
  ],
  routes: {
    '/': { js: ['home'], css: [] },
  },
  outputDir: 'dist',
  ssr: process.argv.includes('--ssr'),
  watch: process.argv.includes('--watch'),
});
