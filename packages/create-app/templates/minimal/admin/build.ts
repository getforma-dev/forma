import { build } from '@getforma/build';

const isSsr = process.argv.includes('--ssr');

await build({
  entryPoints: [
    { entry: 'src/home/app.tsx', outfile: 'home.js' },
  ],
  cssEntries: [
    { input: 'src/styles/app.css', outfile: 'app.css' },
  ],
  routes: {
    '/': { js: ['home'], css: ['app'] },
  },
  outputDir: 'dist',
  ssr: isSsr,
  // The SSR root for `/`. Same file as the browser entry: the compiler walks
  // the tree returned by its `mount()` callback into `home.ir`.
  ...(isSsr ? { ssrEntryPoints: { '/': 'src/home/app.tsx' } } : {}),
  ...(process.argv.includes('--watch') ? { watch: true } : {}),
});
