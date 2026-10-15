import {readSourceFile} from './source-snapshot';
import {realpathSync} from 'node:fs';
/**
 * Forma Compiler - esbuild SSR Plugin
 *
 * Captures one source graph for native IR and browser registration metadata,
 * returning both outputs without publishing partial builds.
 */

import type { Plugin, PartialMessage, OutputFile, Loader } from 'esbuild';
import {createHash} from 'node:crypto';

import { join, dirname, resolve, extname } from 'node:path';

import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { IrEmitContext } from './ir-emit';
import { OP_OPEN_TAG, OP_CLOSE_TAG } from './fmir-constants.js';
import { ComponentAnalyzer } from './component-analyzer';
import { readImportBindings, resolveExportedFunction, type ImportBinding } from './export-resolver';
import { fsModuleLoader, loadComponentSource, resolveFilePath, transformJsxSource } from './module-loader';
import {
  collectDiagnostics,
  originalPosition,
  reportDiagnostic,
  type Diagnostic,
  type DiagnosticChainLink,
  type Locatable,
} from './diagnostics';
import { findBrowserOnlyDeclaration, type BrowserOnlyDeclaration } from './browser-only';
import {
  collectSignalDeclarations,
  createSignalImportResolver,
  enterComponentScope,
  enterSignalScope,
  newSignalRegistry,
  resolveModuleSignalImports,
  type SignalScope,
} from './signal-scope';
import { moduleConstantScope, walkHTree, walkCallExpression, type WalkContext } from './ir-walk';
import { readPageProps, PropsSchemaError } from './props-schema';
import { rootPropsScope } from './props-bindings';
import {createIslandRegistry, type IslandRegistry} from './island-registry';
import {SourceSnapshot,withSourceSnapshot} from './source-snapshot';
import {injectIslandMetadata} from './island-product';
import {recordSsrEntryProduct} from './ssr-product';

export interface SsrPluginOptions {
  /** Page name (e.g., 'platform-login') -- used for the output .ir filename */
  page: string;
  /** Output directory for .ir files */
  outDir: string;
  /** Entry point path (e.g., 'src/platform/onboarding/app.ts') for real IR emission */
  entryPoint?: string;
  /** Browser entry whose literal registry receives the paired metadata. */
  clientEntryPoint?: string;
  /**
   * Fail the esbuild build on every coded diagnostic the page reports (except
   * notes), each as an esbuild error with its code, file, line and column.
   * Default false: the diagnostics are warnings, printed as at 0.3.6.
   * `@getforma/build` leaves this off and applies `--strict` itself, across
   * every page at once.
   */
  strict?: boolean;
  /** Receives the page's diagnostics after each emission (`@getforma/build`
   *  gathers them for its result, its JSON report and `--strict`). */
  onDiagnostics?: (diagnostics: Diagnostic[], page: string) => void;
}

// ---------------------------------------------------------------------------
// Parser options
// ---------------------------------------------------------------------------

const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};

// ---------------------------------------------------------------------------
// Real IR Generation
// ---------------------------------------------------------------------------

export interface IrResult {
  binary: Uint8Array;
  islands: ReturnType<IrEmitContext['getIslands']>;
}

/**
 * Build the `resolveComponent` callback the walker uses for sub-component
 * calls, rebasing on the file each call actually appears in.
 *
 * The import map used to be built ONCE from the entry point and captured in a
 * closure, so `StatCard` imported by `pages/OverviewPage.tsx` was invisible
 * unless `app.tsx` happened to import it too — a whole page's components
 * degraded to empty island shells purely because of who imported them.
 * Verified by: packages/compiler/tests/ssr-emission.test.ts > "resolves a sub-component against the file the call is in"
 *
 * `seed` lets the caller pre-register the in-memory source of a file the
 * compiler has already transformed (the entry point), so it is not re-read
 * from disk untransformed.
 */
interface ComponentResolver {
  resolveComponent: NonNullable<WalkContext['resolveComponent']>;
  importOf: NonNullable<WalkContext['importOf']>;
  findBrowserOnly: NonNullable<WalkContext['findBrowserOnly']>;
}

function createComponentResolver(
  seed: Array<{ path: string; source: string }>,
): ComponentResolver {
  // Values are `string | null`; null caches "this file could not be read", so
  // an unreadable file is not retried once per component reference AND is not
  // mistaken for an empty module on the second lookup.
  const sources = new Map<string, string | null>();
  for (const { path, source } of seed) sources.set(path, source);

  const sourceOf = (filePath: string): string | null => {
    const cached = sources.get(filePath);
    if (cached !== undefined) return cached;
    const loaded = loadComponentSource(filePath);
    sources.set(filePath, loaded);
    return loaded;
  };

  const bindingsCache = new Map<string, Map<string, ImportBinding>>();
  const bindingsOf = (filePath: string, source: string) => {
    let bindings = bindingsCache.get(filePath);
    if (!bindings) {
      try {
        bindings = readImportBindings(parse(source, PARSE_OPTS) as any);
      } catch {
        bindings = new Map();
      }
      bindingsCache.set(filePath, bindings);
    }
    return bindings;
  };

  const resolveComponent: ComponentResolver['resolveComponent'] = (name, fromFile) => {
    if (!fromFile) return null;
    const fromSource = sourceOf(fromFile);
    if (fromSource === null) return null;

    // 1. An import in the calling file wins: it names both the file and the
    //    binding the target module exports it under (`import { CardImpl as
    //    Card }` must be looked up as 'CardImpl' over there, not 'Card').
    const binding = bindingsOf(fromFile, fromSource).get(name);
    if (binding) {
      if (binding.imported === '*') return null;
      if (!binding.source.startsWith('.') && !binding.source.startsWith('/')) return null;
      const path = resolveFilePath(dirname(fromFile), binding.source);
      if (!path) return null;
      const source = sourceOf(path);
      if (source === null) return null;
      return { source, functionName: binding.imported, path };
    }

    // 2. Otherwise the calling file may declare it itself — a file-local
    //    helper component, exported or not, top-level or nested.
    const local = resolveExportedFunction(fromSource, fromFile, name, {
      loadModule: fsModuleLoader,
      allowLocal: true,
      allowNested: true,
    });
    if (local.kind === 'found') {
      return { source: fromSource, functionName: name, path: fromFile };
    }

    return null;
  };

  /** The import binding `name` has in `fromFile`: diagnostics only (BUILD-401). */
  const importOf = (name: string, fromFile?: string): ImportBinding | null => {
    if (!fromFile) return null;
    const fromSource = sourceOf(fromFile);
    return fromSource === null ? null : bindingsOf(fromFile, fromSource).get(name) ?? null;
  };

  /** `const X = browserOnly(Impl)`, declared in `fromFile` or imported (L-1). */
  const findBrowserOnly = (name: string, fromFile?: string): BrowserOnlyDeclaration | null => {
    if (!fromFile) return null;
    return findBrowserOnlyDeclaration(name, fromFile, { sourceOf, loadModule: fsModuleLoader });
  };

  return { resolveComponent, importOf, findBrowserOnly };
}

/**
 * Report a page-level failure (a placeholder module, BUILD-6xx), printed as
 * at 0.3.6 with its code, plus the file and position it concerns.
 */
function reportPage(
  code: string,
  file: string,
  text: (where: string) => string,
  node?: Locatable | null,
): void {
  reportDiagnostic({ code, file, node, position: node ? undefined : { line: 1, column: 0 }, text });
}

/** The first link of the composition chain: the page itself (L-26). */
function rootLink(component: string, file: string, node: Locatable | null | undefined): DiagnosticChainLink {
  const start = node?.loc?.start;
  const position = start ? originalPosition(file, start) : { line: 0, column: 0 };
  return { component, file, line: position.line, column: position.column };
}

/**
 * Generate real IR by parsing the entry point, resolving the component,
 * extracting its h() tree, and walking it to produce FMIR binary.
 *
 * Returns the FMIR binary and island info, or null if any step fails (caller falls back to placeholder).
 */
export function generateRealIr(entryPointPath: string): IrResult | null {
  return generateWithRegistry(entryPointPath);
}

function generateWithRegistry(entryPointPath: string, registry?: IslandRegistry): IrResult | null {
  let failure: Error | undefined;
  const { result, diagnostics } = collectDiagnostics(() => {
    try {
      return emitRealIr(entryPointPath, registry);
    } catch (err) {
      failure = err as Error;
      return null;
    }
  });
  if (failure) {
    if (failure instanceof PropsSchemaError) {
      reportDiagnostic({ code: failure.code, file: failure.file, original: true,
        position: { line: failure.line, column: failure.column - 1 }, text: () => failure!.message });
      throw failure;
    }
    // A literal past FMIR's 65,535-byte limit was reported where the author
    // wrote it (BUILD-604); the failure it causes needs no second report.
    const code = (failure as { code?: unknown }).code === 'BUILD-604' ? 'BUILD-604' : 'BUILD-606';
    if (code !== 'BUILD-604' || !diagnostics.some((d) => d.code === 'BUILD-604')) {
      const message = failure.message;
      reportDiagnostic({
        code,
        file: entryPointPath,
        text: (where) => `real emission failed: ${message} (${where})`,
      });
    }
  }
  return result;
}

/** {@link generateRealIr}'s work; throws where the page cannot be emitted. */
function emitRealIr(entryPointPath: string, registry?: IslandRegistry): IrResult | null {
  entryPointPath=realpathSync(entryPointPath);
  // 1. Read the entry point file. A .tsx/.jsx entry has its JSX turned into
  // h() calls first, so the Babel AST parser produces CallExpression nodes
  // (not JSXElement): the IR walker only understands h() call trees.
  const entrySource = transformJsxSource(readSourceFile(entryPointPath), entryPointPath);
  const entryDir = dirname(entryPointPath);

  // 2. Create ComponentAnalyzer and parse entry point
  const analyzer = new ComponentAnalyzer(entryDir);
  // IMPORTANT: JSX transform (step 1b) must run BEFORE parseEntryPoint so that
  // any inlineReturnNode references the transformed AST (h() calls, not JSX nodes).
  const entryInfo = analyzer.parseEntryPoint(entrySource, entryPointPath);
  if (!entryInfo) {
    reportPage('BUILD-601', entryPointPath, (where) => `could not find mount() call in ${where}`);
    return null;
  }
  const islandRegistry=registry??createIslandRegistry(entryPointPath);

  // Follows imports so a signal declared in a store module folds on this
  // page. One per page — its caches make the expensive work per-module, not
  // per-importer. The injected reader judges an imported signal by exactly
  // the rules a local one gets (same collector, same module-const folding)
  // but QUIETLY: the eager scan reads modules whose signals may never
  // appear on this page, and a warning about a signal nobody reads is
  // noise — a read of an unfoldable signal still warns at its use site.
  const signalImports = createSignalImportResolver(fsModuleLoader, (source, filePath) =>
    collectSignalDeclarations(
      (parse(source, PARSE_OPTS) as unknown as t.File).program.body,
      {
        filePath,
        constants: moduleConstantScope(source, filePath, fsModuleLoader).stringConstants,
        quiet: true,
      },
    ),
  );

  // ── Handle inline return from block-body mount() (Pattern 3) ──
  if (entryInfo.componentName === '__inline__' && entryInfo.inlineReturnNode) {
    const ctx = new IrEmitContext();
    const signalRegistry = newSignalRegistry();

    const { resolveComponent, importOf, findBrowserOnly } = createComponentResolver([
      { path: entryPointPath, source: entrySource },
    ]);

    // The entry point's own module scope: its constants, and the resolver
    // for tables it imports (Rule 9's unroll).
    const { fileConstants, stringConstants, resolveImportedConstant } =
      moduleConstantScope(entrySource, entryPointPath, fsModuleLoader);

    // An inline mount has no exported component to look inside: the page's
    // scope chain is the entry file's module scope, then the mount
    // callback's own body. Both are real lexical scopes of the tree being
    // walked, which is why the walk reads them and no separate extractor
    // has to know this pattern exists.
    // Verified by: packages/compiler/tests/ssr-emission.test.ts > "names signal slots on an inline-mount entry"
    const entryAst = parse(entrySource, PARSE_OPTS);
    let signalScope: SignalScope = enterSignalScope(
      null,
      `${entryPointPath}#module`,
      collectSignalDeclarations(entryAst.program.body, {
        filePath: entryPointPath,
        constants: stringConstants,
      }),
      ctx,
      signalRegistry,
    );
    // An inline-mount page can keep its signals in a store module too — the
    // module frame gets the same import resolution enterComponentScope does.
    resolveModuleSignalImports(
      signalScope,
      entryAst as unknown as t.File,
      entryPointPath,
      signalImports,
      ctx,
      signalRegistry,
    );
    if (entryInfo.inlineMountBody) {
      signalScope = enterSignalScope(
        signalScope,
        `${entryPointPath}#mount`,
        collectSignalDeclarations(entryInfo.inlineMountBody, {
          filePath: entryPointPath,
          constants: stringConstants,
        }),
        ctx,
        signalRegistry,
      );
    }

    const emptyFn = t.arrowFunctionExpression([], entryInfo.inlineMountBody
      ? t.blockStatement(entryInfo.inlineMountBody) : entryInfo.inlineReturnNode!);
    const propsScope = rootPropsScope({ schema: [[]], parameter: { kind: 'none' } }, emptyFn, entryPointPath, ctx);
    const walkCtx: WalkContext = {
      propsScope,
      islandRegistry,islandSchemas:new Map(),
      sourceFile: entryPointPath,
      fileConstants,
      stringConstants,
      resolveImportedConstant,
      signalScope,
      signalRegistry,
      signalImports,
      resolveComponent,
      importOf,
      findBrowserOnly,
      chain: [rootLink('mount()', entryPointPath, entryInfo.inlineReturnNode)],
      loadModule: fsModuleLoader,
      visited: new Set(),
      depth: 0,
      islandNames: entryInfo.islandNames,
      // Per-page slot-name registries MUST be created on the root context
      // (not lazily inside a spread-copied nested context) so every list,
      // show, dynamic attribute and dynamic text child on the page dedups
      // against one shared namespace.
      // Verified by: packages/compiler/tests/ir-walk.test.ts > "dedupes a dynamic attr inside an island against one on the page"
      listNames: { counts: new Map(), total: 0 },
      showNames: { counts: new Map(), total: 0 },
      attrNames: new Map(),
      textNames: new Map(),
    };

    const returnNode = entryInfo.inlineReturnNode;

    if (t.isCallExpression(returnNode) && t.isIdentifier(returnNode.callee) && returnNode.callee.name === 'h') {
      walkHTree(returnNode, 'h', ctx, walkCtx);
    } else if (t.isCallExpression(returnNode)) {
      walkCallExpression(returnNode, 'h', ctx, walkCtx);
    } else {
      reportPage(
        'BUILD-603',
        entryPointPath,
        (where) => `inline return node is not a call expression (${where})`,
        returnNode,
      );
      return null;
    }

    const binary = ctx.toBinary();
    const islands = ctx.getIslands();

    return { binary, islands };
  }

  // ── Original code continues for Pattern 1 & 2 (named component) ──

  // 3. Resolve the component file path
  const componentPath = entryInfo.localComponent ? entryPointPath : resolveFilePath(entryDir, entryInfo.importPath);
  if (!componentPath) {
    reportPage(
      'BUILD-602',
      entryPointPath,
      (where) => `could not resolve component '${entryInfo.importPath}' from ${entryDir} (${where})`,
    );
    return null;
  }

  // 4. Read and parse the component file (transform JSX if needed)
  const componentSource = loadComponentSource(componentPath);
  if (componentSource === null) {
    reportPage('BUILD-602', componentPath, (where) => `could not read component file ${where}`);
    return null;
  }

  // 4b. The entry's import binding names what the component module exports
  // it under: `import { PageImpl as Page }` must be looked up as 'PageImpl'.
  const exportedName =
    entryInfo.importBindings?.get(entryInfo.componentName)?.imported
    ?? entryInfo.componentName;

  // 5. Find the root component's h() tree. The function may be DECLARED in
  // another file (a barrel forwarded the export), and everything scoped to
  // the module — constants, imports, diagnostics — has to follow it there.
  const componentInfo = analyzer.parseComponentFile(
    componentSource,
    componentPath,
    exportedName,
    {
      loadModule: fsModuleLoader,
      allowLocal: entryInfo.localComponent === true,
      onUnresolved: (detail) => reportPage(
        'BUILD-602',
        componentPath,
        (where) => `${detail} — the page falls back to placeholder IR, so it server-renders as an empty <div id="app"> and shows nothing at all until the client bundle hydrates (${where})`,
      ),
    },
  );
  if (!componentInfo) return null;

  const rootPath = componentInfo.filePath;
  const rootSource = componentInfo.source;

  // 6. The root page module's constant scope: the tables it declares (for
  // Rule 9's static unroll), the strings it declares (for static attribute
  // resolution), and the resolver for tables it IMPORTS.
  const { fileConstants, stringConstants, resolveImportedConstant } =
    moduleConstantScope(rootSource, rootPath, fsModuleLoader);

  // 7. Create IrEmitContext and open the root page's scope chain: the page
  // FILE's module scope, then the page COMPONENT's own body. Island and
  // sub-component scopes are NOT gathered here — the walk pushes each one as
  // it inlines that component, which is what makes a scope the walk learns
  // to inline later work without a matching extractor being written for it.
  const ctx = new IrEmitContext();
  const declaredProps = readPageProps(componentPath, exportedName);
  ctx.setPropsSchema(declaredProps.schema);
  const propsScope = rootPropsScope(declaredProps, componentInfo.fn, rootPath, ctx);
  const signalRegistry = newSignalRegistry();
  const signalScope = enterComponentScope({
    ast: componentInfo.ast,
    fn: componentInfo.fn,
    fnName: exportedName,
    propSeeds: propsScope ? new Set(propsScope.signals.keys()) : undefined,
    filePath: rootPath,
    constants: stringConstants,
    ctx,
    registry: signalRegistry,
    imports: signalImports,
  });

  // 8. Build resolve callback for sub-components
  const { resolveComponent, importOf, findBrowserOnly } = createComponentResolver([
    { path: entryPointPath, source: entrySource },
    { path: componentPath, source: componentSource },
    { path: rootPath, source: rootSource },
  ]);

  // 9. Build WalkContext and walk the h() tree
  const walkCtx: WalkContext = {
    propsScope,
    islandRegistry,islandSchemas:new Map(),
    sourceFile: rootPath,
    fileConstants,
    stringConstants,
    resolveImportedConstant,
    signalScope,
    signalRegistry,
    signalImports,
    resolveComponent,
    importOf,
    findBrowserOnly,
    chain: [rootLink(entryInfo.componentName, rootPath, componentInfo.fn)],
    loadModule: fsModuleLoader,
    visited: new Set(),
    depth: 0,
    islandNames: entryInfo.islandNames,
    // Per-page slot-name registries MUST be created on the root context
    // (not lazily inside a spread-copied nested context) so every list
    // and show on the page dedups against one shared namespace.
    listNames: { counts: new Map(), total: 0 },
    showNames: { counts: new Map(), total: 0 },
    attrNames: new Map(),
    textNames: new Map(),
  };

  const returnNode = componentInfo.returnNode;

  if (t.isCallExpression(returnNode) && t.isIdentifier(returnNode.callee) && returnNode.callee.name === 'h') {
    walkHTree(returnNode, 'h', ctx, walkCtx);
  } else if (t.isCallExpression(returnNode)) {
    walkCallExpression(returnNode, 'h', ctx, walkCtx);
  } else {
    reportPage(
      'BUILD-603',
      rootPath,
      (where) => `return node is not a call expression in ${entryInfo.componentName} (${where})`,
      returnNode,
    );
    return null;
  }

  // 10. Return the binary and island metadata
  return {
    binary: ctx.toBinary(),
    islands: ctx.getIslands(),
  };
}

// ---------------------------------------------------------------------------
// Placeholder IR Generation
// ---------------------------------------------------------------------------

/**
 * Generate a placeholder IR for a page.
 *
 * Produces a minimal FMIR binary representing:
 *   <div id="app" data-forma-page="{pageName}"></div>
 *
 * This is the fallback every page lands on when real IR emission fails: the
 * shell the client-side mount hydrates into. Exported so the test suite can
 * exercise THIS function rather than a copy of its body — a re-implementation
 * in the test would keep passing while the shipped fallback was broken.
 * Verified by: packages/compiler/tests/ir-roundtrip.test.ts > "placeholder IR from the SSR plugin has valid structure"
 */
export function generatePlaceholderIr(pageName: string): Uint8Array {
  const ctx = new IrEmitContext();

  const divIdx = ctx.addString('div');
  const idKeyIdx = ctx.addString('id');
  const idValIdx = ctx.addString('app');
  const pageKeyIdx = ctx.addString('data-forma-page');
  const pageValIdx = ctx.addString(pageName);

  // OPEN_TAG "div" with 2 static attrs: id="app" data-forma-page="{pageName}"
  ctx.emit(OP_OPEN_TAG);
  ctx.emitU32(divIdx);
  ctx.emitU16(2); // 2 attributes
  ctx.emitU32(idKeyIdx);
  ctx.emitU32(idValIdx);
  ctx.emitU32(pageKeyIdx);
  ctx.emitU32(pageValIdx);

  // CLOSE_TAG "div"
  ctx.emit(OP_CLOSE_TAG);
  ctx.emitU32(divIdx);

  return ctx.toBinary();
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Compile a paired browser/native product. Requires esbuild write:false: the
 * caller publishes outputFiles only after the complete build succeeds.
 */
export function formaSsrPlugin(options: SsrPluginOptions): Plugin {
  return {
    name: 'forma-ssr-ir',
    setup(build) {
      if(build.initialOptions.write!==false)throw new Error('formaSsrPlugin requires esbuild write:false; publish returned outputFiles only after a successful build');
      const entry=options.entryPoint?realpathSync(options.entryPoint):undefined;
      const client=options.clientEntryPoint?realpathSync(options.clientEntryPoint):entry;
      const points=build.initialOptions.entryPoints;
      const browserEntries=new Set((Array.isArray(points)?points.map(point=>typeof point==='string'?point:point.in):Object.values(points??{})).map(file=>realpathSync(resolve(build.initialOptions.absWorkingDir??process.cwd(),file))));
      let snapshot:SourceSnapshot,bytes:Uint8Array|undefined,transformed:string|undefined,product:IrResult|null;
      let diagnostics:Diagnostic[]=[],fatal:Error|undefined;
      build.onStart(()=>{
        snapshot=new SourceSnapshot();bytes=undefined;transformed=undefined;fatal=undefined;product=null;
        const collected=collectDiagnostics(()=>{
          try {
            withSourceSnapshot(snapshot,()=>{
              const registry=entry?createIslandRegistry(entry):undefined;
              product=entry?generateWithRegistry(entry,registry):null;
              bytes=product?.binary??generatePlaceholderIr(options.page);
              if(client&&registry)transformed=injectIslandMetadata(client,registry,product);
              console.log(`   IR emitted (${product?'real':'placeholder'}): ${options.page}.ir (${bytes.length} bytes${product?`, ${product.islands.length} islands`:''})`);
            });
          } catch(error) {
            fatal=error as Error;
            if(error instanceof PropsSchemaError)reportDiagnostic({code:error.code,file:error.file,original:true,position:{line:error.line,column:error.column-1},text:()=>error.message});
          }
        });
        const seen=new Set<string>();
        diagnostics=collected.diagnostics.filter(d=>{const key=JSON.stringify([d.code,d.file,d.line,d.column,d.message]);if(seen.has(key))return false;seen.add(key);return true;});
        options.onDiagnostics?.(diagnostics,options.page);
      });
      // All compiler reads use the same snapshot, and browser loads use those
      // exact bytes. SSR-only/type-only dependencies join this browser watcher.
      build.onLoad({filter:/\.[cm]?[jt]sx?$/},args=>{
        const file=resolve(args.path);
        if(file!==client&&(browserEntries.has(file)||!snapshot.files.has(file)))return;
        const loader=extname(file).slice(1).replace(/^[cm](?=[jt]s$)/,'') as Loader;
        return {contents:file===client?(transformed??snapshot.files.get(file)??readSourceFile(file)):snapshot.files.get(file),loader,resolveDir:dirname(file),watchFiles:[...snapshot.files.keys(),...snapshot.dependencies],watchDirs:[...snapshot.directories]};
      });
      build.onEnd(result=>{
        if(result.errors.length)return;
        const errors:PartialMessage[]=diagnostics.filter(d=>d.code==='BUILD-610'||(options.strict&&d.strict)).map(d=>({id:d.code,text:`${d.code} ${d.message}`,location:d.file?{file:d.file,line:d.line||1,column:Math.max(0,d.column-1)}:null,notes:[{text:`why: ${d.why}`},{text:`fix: ${d.fix}`}]}));
        if(fatal&&!errors.length)errors.push({text:`BUILD-606 IR emission failed for ${options.page}: ${fatal.message}`});
        if(!fatal&&!snapshot.unchanged())errors.push({text:`BUILD-610 sources changed while compiling ${options.page}; retry to publish a coherent browser/IR pair`});
        if(errors.length)return {errors};
        if(!product||!entry||!client)return {errors:[{text:`BUILD-610 ${options.page} requires a successful native product; a placeholder cannot establish static or island entry policy`}]};
        if(!bytes||!result.outputFiles)return {errors:[{text:`BUILD-606 missing paired output for ${options.page}`}]};
        const contents=bytes;
        const output:OutputFile={path:resolve(options.outDir,`${options.page}.ir`),contents,hash:createHash('sha256').update(contents).digest('hex'),get text(){return Buffer.from(contents).toString('utf8');}};
        result.outputFiles.push(output);
        recordSsrEntryProduct(result,output,{page:options.page,sourceEntry:entry,browserEntry:client,
          islands:product.islands.map(island=>({name:island.name,mode:island.contract!.mode}))});
      });
    },
  };
}
