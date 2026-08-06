import { build } from '@getforma/build';

// This dashboard ships Phase 1 (client mount) on purpose — see the
// "Phase 1 by design" section of the README for the measurement behind that.
// There is deliberately no `ssr: true` here: enabling it emits an IR file
// whose SSR tree is island placeholders the client cannot adopt.
await build({
  entryPoints: [
    { entry: 'src/app.tsx', outfile: 'dashboard.js' },
  ],
  routes: {
    '/': { js: ['dashboard'], css: ['dashboard'] },
  },
  cssEntries: [
    { input: 'src/styles/dashboard.css', outfile: 'dashboard.css', tailwind: true },
  ],
  outputDir: 'dist',
  ...(process.argv.includes('--watch') ? { watch: true } : {}),
});
