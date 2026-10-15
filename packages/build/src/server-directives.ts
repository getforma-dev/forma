import { parse } from '@babel/parser';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import * as esbuild from 'esbuild';
import type { BuildConfig, BuildDiagnostic } from './types.js';
import { writeDiagnosticsJson } from './diagnostics.js';

/** Every source module in the bundle is checked, including watch rebuilds. */
export function serverDirectiveGuard(): esbuild.Plugin {
  return {
    name: 'forma-no-server-functions',
    setup(builder) {
      builder.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, args => {
        const source = readFileSync(args.path, 'utf8');
        if (!source.includes('use server')) return;
        // Parse directive nodes: comments and an ordinary string value are not RPC code.
        const ast = parse(source, { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins: ['typescript', 'jsx', 'decorators-legacy'] });
        const errors: esbuild.PartialMessage[] = [];
        const visit = (node: unknown): void => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) { node.forEach(visit); return; }
          const item = node as { type?: string; value?: { value?: string }; loc?: { start: { line: number; column: number } } };
          if (item.type === 'Directive' && item.value?.value === 'use server') {
            const diagnostic: BuildDiagnostic = {
              code: 'BUILD-808', severity: 'error', page: basename(args.path, extname(args.path)),
              file: args.path, line: item.loc?.start.line ?? 0, column: (item.loc?.start.column ?? 0) + 1,
              message: 'Server functions ("use server") were removed. Move this operation to a Rust route and call it with fetch.',
              why: 'Forma builds browser code; a server function body must never ship as a browser implementation.',
              fix: 'Move server-side work to an authenticated Rust route and call that route from the browser.',
            };
            errors.push({ text: `${diagnostic.code}: ${diagnostic.message}`, detail: diagnostic, location: { file: args.path, line: diagnostic.line, column: diagnostic.column - 1, lineText: source.split(/\r?\n/)[diagnostic.line - 1] ?? '' } });
          }
          for (const [key, value] of Object.entries(node)) if (!['loc', 'tokens', 'comments', 'leadingComments', 'trailingComments'].includes(key)) visit(value);
        };
        visit(ast);
        if (errors.length) return { errors };
      });
    },
  };
}

/** Check the full browser/SSR source graphs before touching output, including initial watch. */
export async function assertNoServerFunctions(config: BuildConfig, options: esbuild.BuildOptions): Promise<void> {
  const entries = [...new Set(config.entryPoints.flatMap(entry => {
    const ssrEntry = config.ssr && entry.ssr !== false
      ? config.ssrEntryPoints?.[basename(entry.outfile, '.js')]
      : undefined;
    return ssrEntry ? [entry.entry, ssrEntry] : [entry.entry];
  }))];
  if (!entries.length) return;
  try {
    await esbuild.build({ ...options, entryPoints: Object.fromEntries(entries.map((entry, i) => [`entry-${i}`, entry])), outdir: config.outputDir, write: false, minify: false, sourcemap: false, logLevel: 'error', plugins: [serverDirectiveGuard()] });
  } catch (error) {
    const diagnostics = ((error as esbuild.BuildFailure).errors ?? []).map(e => e.detail as BuildDiagnostic).filter(d => d?.code === 'BUILD-808');
    if (diagnostics.length) {
      if (config.diagnosticsJson) writeDiagnosticsJson(config.diagnosticsJson, config.strict === true, diagnostics);
      Object.assign(error as Error, { diagnostics });
    }
    throw error;
  }
}
