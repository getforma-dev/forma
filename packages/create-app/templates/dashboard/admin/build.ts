import { build } from '@getforma/build';

const isWatch = process.argv.includes('--watch');
const isSsr = process.argv.includes('--ssr');

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
  ssr: isSsr,
  ...(isSsr ? { ssrEntryPoints: { '/': 'src/app.tsx' } } : {}),
  ...(isWatch ? { watch: true } : {}),
});
