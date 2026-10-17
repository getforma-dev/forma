import { build } from '@getforma/build';
import { ROUTES } from '../../workload.mjs';

if (!process.argv.includes('--ssr') || !process.argv.includes('--strict')) {
  throw new Error('This fixture requires its public SSR strict build command');
}
await build({
  app: 'forma-n7-a9',
  entryPoints: ROUTES.map((_, i) => ({ entry: `src/generated/page${String(i).padStart(2, '0')}/app.tsx`, outfile: `page${String(i).padStart(2, '0')}.js` })),
  routes: Object.fromEntries(ROUTES.map((route, i) => [route, { js: [`page${String(i).padStart(2, '0')}`], css: ['app'] }])),
  cssEntries: [{ input: 'src/styles.css', outfile: 'app.css' }],
  outputDir: 'dist',
  ssr: true,
  strict: true,
  watch: process.argv.includes('--watch'),
});
if (process.argv.includes('--watch')) console.log('FORMA_N7_WATCH_READY');
