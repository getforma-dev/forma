/**
 * @getforma/build — Public API
 *
 * Parameterized build pipeline for Forma applications.
 * Handles esbuild bundling, CSS generation, SSR IR emission,
 * content hashing, compression, manifest generation, and more.
 */

export { build } from './build.js';
// The runtime surface stays `build` alone; the size report's shapes are types.
// N2's ceilings (route-size.ts) are policy, not options.
export type { BuildTimes, ByteSizes, FileSize, FrameSize, RouteCeilings, RouteClass, RouteSize, RouteSizeFile, SizeReport } from './route-size.js';

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
