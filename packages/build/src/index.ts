/**
 * @getforma/build — Public API
 *
 * Parameterized build pipeline for Forma applications.
 * Handles esbuild bundling, CSS generation, SSR IR emission,
 * content hashing, compression, manifest generation, and more.
 */

export { build } from './build.js';
// The runtime surface stays `build` alone; the size report's shapes are types.
// Framework ceilings remain fixed; application budget configuration is typed below.
export type { BuildTimes, ByteSizes, FileSize, FrameSize, RouteCeilings, RouteClass, RouteSize, RouteSizeFile, SizeReport } from './route-size.js';

export type {
  BuildConfig,
  NavigationGroup,
  NavigationBootstrap,
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

export type { SizeBudgetError } from './size-budgets.js';
export type { SizeBudgets, SizeBudgetMetrics, SizeBudgetThresholds, SizeBudgetEvaluation, SizeMetric, SizePolicy } from './size-budgets.js';
