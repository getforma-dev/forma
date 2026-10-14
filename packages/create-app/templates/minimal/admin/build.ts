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
  // The SSR root of the `home` page. Keyed by page name, the entry's outfile
  // without `.js`, which is how @getforma/build looks it up; a route key is
  // never read. Same file as the browser entry: the compiler walks the tree
  // returned by its `mount()` callback into `home.ir`.
  ...(isSsr ? { ssrEntryPoints: { home: 'src/home/app.tsx' } } : {}),
  ...(process.argv.includes('--watch') ? { watch: true } : {}),
});
