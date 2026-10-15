/**
 * @getforma/build — Public API
 *
 * Parameterized build pipeline for Forma applications.
 * Handles esbuild bundling, CSS generation, SSR IR emission,
 * content hashing, compression, manifest generation, and more.
 */

export { build } from './build.js';
// The runtime surface stays `build` alone; the size report's shapes are types.
// N2's ceiling (FORMA_CODE_CEILING_GZIP, route-size.ts) is policy, not an option.
export type { ByteSizes, RouteSize, RouteSizeFile } from './route-size.js';

export type {
  BuildConfig,
  BuildEntry,
  BuildResult,
  CssEntry,
  RouteMapping,
  AssetManifest,
  AssetMetadata,
  RouteManifest,
  BuildDiagnostic,
  BuildDiagnosticChainLink,
} from './types.js';
