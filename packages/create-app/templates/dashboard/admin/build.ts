import { build } from '@getforma/build';

const isWatch = process.argv.includes('--watch');

await build({
  entryPoints: [
    { entry: 'src/app.tsx', outfile: 'dashboard.js' },
  ],
  routes: {
    '/': { js: ['dashboard'], css: ['dashboard'] },
  },
  cssEntries: [
    { input: 'src/styles/dashboard.css', outfile: 'dashboard.css' },
  ],
  outputDir: 'dist',
  ...(isWatch ? { watch: true } : {}),
});
