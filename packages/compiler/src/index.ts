/**
 * Forma Compiler - Public API
 *
 * FMIR generation and the esbuild SSR integration.
 */

export { getSsrEntryProducts, type SsrEntryProduct } from './ssr-product.js';
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
