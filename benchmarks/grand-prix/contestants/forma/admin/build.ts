import { build } from '@getforma/build';

// Server-only page: SSR build, no island, no browser JavaScript.
await build({
  app: 'grandprix',
  entryPoints: [{ entry: 'src/page/app.tsx', outfile: 'page.js' }],
  routes: { '/ssr': { js: ['page'], css: [] } },
  outputDir: 'dist',
  ssr: true,
  ssrEntryPoints: { page: 'src/page/app.tsx' },
  strict: true,
});
