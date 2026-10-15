import { build } from '@getforma/build';

// This dashboard is rendered in the browser on purpose — see the "Phase 1 by
// design" section of the README for the measurement behind that. Its entry
// declares it (`ssr: false`), the server serves its pages through
// `render_browser_shell`, and nothing here turns SSR on: an SSR build of this
// app emits island placeholders the client cannot adopt.
await build({
  entryPoints: [
    { entry: 'src/app.tsx', outfile: 'dashboard.js', ssr: false },
  ],
  routes: {
    '/': { js: ['dashboard'], css: ['dashboard'] },
  },
  cssEntries: [
    { input: 'src/styles/dashboard.css', outfile: 'dashboard.css', tailwind: true },
  ],
  outputDir: 'dist',
  // Strict mode, which the npm scripts ask for: should you add a
  // server-rendered page, a construct the compiler cannot render on the server
  // fails the build, naming its code, file and line. Without the flag,
  // FORMA_STRICT=1 turns it on.
  ...(process.argv.includes('--strict') ? { strict: true } : {}),
  ...(process.argv.includes('--watch') ? { watch: true } : {}),
});
