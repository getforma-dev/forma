/**
 * Forma Compiler - Public API
 *
 * Re-exports the Vite plugin and the core transform function.
 */

export { formaCompiler, type FormaCompilerOptions } from './vite-plugin.js';
export { compileFormaJSX } from './transform.js';
export { formaServer, type FormaServerOptions } from './vite-plugin.js';
export { transformServerFunctions } from './server-transform.js';
export { formaSsrPlugin, generateRealIr, type SsrPluginOptions, type IrResult } from './esbuild-ssr-plugin.js';
export {
  DIAGNOSTIC_CATALOGUE,
  collectDiagnostics,
  diagnosticEntry,
  formatDiagnostic,
  makeDiagnostic,
  type Diagnostic,
  type DiagnosticChainLink,
  type DiagnosticEntry,
} from './diagnostics.js';
export { IrEmitContext, type PropsSchema, type SchemaField, type SchemaType, type KeyPath, type SourcePosition } from './ir-emit.js';
export { dumpFmir, readFmirContainer, encodeFmirSections, crc32, baseWriterVersion, COMPILER_WRITER_VERSION, FmirContainerError, type WriterVersion, type FmirSection } from './fmir.js';
export {
  ComponentAnalyzer,
  type AnalyzerLookupOptions,
  type ComponentInfo,
  type EntryPointInfo,
} from './component-analyzer.js';
export {
  collectSignalDeclarations,
  createSignalImportResolver,
  enterComponentScope,
  enterSignalScope,
  lookupSignal,
  newSignalRegistry,
  resolveModuleSignalImports,
  type ResolvedSignalImport,
  type SignalBinding,
  type SignalDefault,
  type SignalImportResolver,
  type SignalRegistry,
  type SignalScope,
} from './signal-scope.js';
export {
  resolveExportedConstant,
  resolveExportedFunction,
  resolveExportedSignal,
  resolveImportedConstant,
  readImportBindings,
  returnExpressionOf,
  type ConstantLookup,
  type ConstantTable,
  type ExportLookup,
  type ImportBinding,
  type ResolveConstantOptions,
  type ResolveExportOptions,
  type ResolveSignalOptions,
  type SignalExportLookup,
} from './export-resolver.js';
export {
  fsModuleLoader,
  loadComponentSource,
  resolveFilePath,
  type ModuleLoader,
} from './module-loader.js';
export { classifySubtree, SubtreeClassification } from './ir-analyze.js';
export {
  moduleConstantScope,
  walkHTree,
  walkCallExpression,
  type ModuleConstantScope,
  type WalkContext,
} from './ir-walk.js';
