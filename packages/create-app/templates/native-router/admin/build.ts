import { build } from '@getforma/build';

// Each entry is a separately compiled native owner; the group shares one
// closed, integrity-checked bootstrap containing all declared island code.
await build({
  app: '{{APP_NAME}}',
  ssr: true,
  entryPoints: [
    { entry: 'src/shell/app.tsx', outfile: 'shell.js' },
    { entry: 'src/home/app.tsx', outfile: 'home.js' },
    { entry: 'src/about/app.tsx', outfile: 'about.js' },
  ],
  ssrEntryPoints: {
    shell: 'src/shell/app.tsx',
    home: 'src/home/app.tsx',
    about: 'src/about/app.tsx',
  },
  navigationGroups: [{ id: 'main', owners: ['shell', 'home', 'about'], client: 'src/navigation.ts' }],
  cssEntries: [{ input: 'src/styles/app.css', outfile: 'app.css' }],
  routes: {
    '/_layout': { js: ['shell'], css: ['app'] },
    '/': { js: ['home'], css: ['app'] },
    '/about': { js: ['about'], css: ['app'] },
  },
  outputDir: 'dist',
  ...(process.argv.includes('--strict') ? { strict: true } : {}),
});
