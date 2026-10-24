import { build } from '@getforma/build';

// Keep the original static dashboard and add the separate native island track.
await build({
  app: 'grandprix',
  entryPoints: [{ entry: 'src/page/app.tsx', outfile: 'page.js' }, { entry: 'src/island/app.tsx', outfile: 'island.js' }],
  routes: { '/ssr': { js: ['page'], css: [] }, '/island': { js: ['island'], css: [] } },
  outputDir: 'dist',
  ssr: true,
  ssrEntryPoints: { page: 'src/page/app.tsx', island: 'src/island/app.tsx' },
  strict: true,
});
