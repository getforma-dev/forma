import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BUILD_WRITER_VERSION } from './compatibility.js';
import type { AssetManifest, AssetMetadata, BuildConfig, RouteManifest } from './types.js';

export function generateManifest(
  config: BuildConfig,
  assets: Record<string, string>,
  staticDependencies: Record<string, string[]> = {},
  graphFiles: ReadonlySet<string> = new Set(),
): { manifest: AssetManifest; warnings: string[] } {
  const distDir = config.outputDir;
  const BUDGET_THRESHOLD = config.budgetThreshold ?? 200_000;
  const warnings: string[] = [];

  // Build hash: SHA-256 of all hashed filenames sorted and joined
  const buildHash = createHash('sha256')
    .update(Object.values(assets).sort().join(','))
    .digest('hex');

  // Collect font files (stable names, not hashed)
  const fonts = readdirSync(distDir)
    .filter((f) => f.endsWith('.woff2'))
    .sort();

  // Build route manifest
  const routes: Record<string, RouteManifest> = {};

  for (const [route, mapping] of Object.entries(config.routes)) {
    const jsFiles = mapping.js.map(
      (name) => assets[`${name}.js`] ?? `${name}.js`,
    );
    const cssFiles = mapping.css.map(
      (name) => assets[`${name}.css`] ?? `${name}.css`,
    );
    const modulepreload = [...new Set(jsFiles.flatMap(file => staticDependencies[file] ?? []))].filter(file => !jsFiles.includes(file));

    // Use route-level fonts if specified, otherwise all fonts
    const routeFonts = mapping.fonts ?? fonts;

    // Calculate total size using brotli sizes when available
    let totalSize = 0;
    for (const f of new Set([...jsFiles, ...modulepreload, ...cssFiles])) {
      const brPath = join(distDir, `${f}.br`);
      const origPath = join(distDir, f);
      if (existsSync(brPath)) {
        totalSize += statSync(brPath).size;
      } else if (existsSync(origPath)) {
        totalSize += statSync(origPath).size;
      }
    }
    // Add font sizes (uncompressed — woff2 is already compressed)
    for (const f of routeFonts) {
      const fp = join(distDir, f);
      if (existsSync(fp)) {
        totalSize += statSync(fp).size;
      }
    }

    const entry = config.entryPoints.find(entry => basename(entry.outfile, '.js') === mapping.js[0]);
    const serverRendered = config.ssr === true && entry !== undefined && entry.ssr !== false;
    const routeEntry: RouteManifest = {
      mode: serverRendered ? 'ssr' : 'browser',
      js: jsFiles,
      ...(modulepreload.length ? { modulepreload } : {}),
      css: cssFiles,
      fonts: routeFonts,
      total_size_br: totalSize,
      budget_warn_threshold: BUDGET_THRESHOLD,
    };

    // If SSR mode, check for .ir files and add to route manifest
    if (serverRendered) {
      const pageName = mapping.js[0];
      if (pageName) {
        const irFile = `${pageName}.ir`;
        if (assets[irFile]) {
          routeEntry.ir = assets[irFile];
        }
      }
    }

    if (serverRendered && !routeEntry.ir) throw new Error(`BUILD-817 route ${route} declares SSR but its compiled module is missing; fix compilation before serving this build`);
    routes[route] = routeEntry;

    // Budget warning
    if (totalSize > BUDGET_THRESHOLD) {
      const kb = (totalSize / 1024).toFixed(1);
      const msg = `Budget exceeded: ${route} -> ${kb}KB (threshold: ${BUDGET_THRESHOLD / 1024}KB)`;
      warnings.push(msg);
      console.warn(`   Warning: ${msg}`);
    }
  }

  // Metadata is based on the build graph/hash operation, never a filename guess.
  const immutable = new Set(Object.entries(assets).filter(([logical, file]) => logical !== file).map(([, file]) => file));
  if (!config.watch) for (const file of graphFiles) immutable.add(file);
  const metadata: Record<string, AssetMetadata> = {};
  for (const file of readdirSync(distDir).sort()) {
    if (file === 'manifest.json' || file === 'sw.js' || /\.(?:br|gz)$/.test(file)) continue;
    if (!statSync(join(distDir, file)).isFile()) continue;
    metadata[file] = {
      immutable: !config.watch && immutable.has(file),
      integrity: `sha384-${createHash('sha384').update(readFileSync(join(distDir, file))).digest('base64')}`,
    };
  }
  const aliases = { ...assets };
  for (const entry of config.entryPoints) if (metadata[entry.outfile]) aliases[entry.outfile] ??= entry.outfile;
  for (const entry of config.cssEntries ?? []) if (metadata[entry.outfile]) aliases[entry.outfile] ??= entry.outfile;
  for (const route of Object.values(routes)) {
    for (const file of [...route.js, ...(route.modulepreload ?? []), ...route.css, ...route.fonts, ...(route.ir ? [route.ir] : [])]) {
      if (!metadata[file]) throw new Error(`BUILD-817 manifest references missing asset ${file}`);
    }
  }
  const manifest: AssetManifest = {
    version: 2,
    writer: BUILD_WRITER_VERSION.join('.'),
    app: config.app!,
    build: config.watch ? 'dev' : buildHash,
    aliases,
    assets: metadata,
    routes,
  };
  return { manifest, warnings };
}

