import {createIslandRootProofs} from './island-root-proof';
import {readSourceFile} from './source-snapshot';
import {isCoreCall} from './entry-policy';
import {realpathSync} from 'node:fs';
/** Resolve literal activation registrations to original lexical declarations. */

import { dirname } from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
import * as t from '@babel/types';
import { resolveFilePath, type ModuleLoader } from './module-loader';
import { readImportBindings, resolveExportedFunction, type ComponentFunction } from './export-resolver';
import { findBrowserOnlyDeclaration } from './browser-only';
import { analyzeIslandBindings, type IslandBindings } from './island-bindings';
import { canonicalIslandSchema, type IslandRenderMode } from './fmir-contracts';
import { PropsSchemaError, readFunctionProps, type DeclaredPageProps } from './props-schema';

export interface RegisteredIsland {
  name: string;
  identity: string;
  file: string;
  source: string;
  fn: ComponentFunction;
  mode: IslandRenderMode;
  declared: DeclaredPageProps;
  analyze(): IslandBindings;
  proveRoot(): void;
}
export interface IslandRegistry {
  resolve(name: string, file: string): RegisteredIsland | undefined;
  entries(): readonly {island:RegisteredIsland;local:string;start:number;end:number}[];
}
export const rawModuleLoader: ModuleLoader = (from, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const file = resolveFilePath(dirname(from), specifier);
  return file ? { path: file, source: readSourceFile(file) } : null;
};
const key = (node: t.Node): string | undefined => t.isIdentifier(node) || t.isStringLiteral(node) ? (t.isIdentifier(node) ? node.name : node.value) : undefined;
const callable = (node: t.Node | null | undefined): node is ComponentFunction => t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node);

export function createIslandRegistry(entry: string): IslandRegistry {
  entry=realpathSync(entry);
  const sources = new Map<string,string>();
  const source = (file: string): string => {
    let value = sources.get(file);
    if (value === undefined) { value = readSourceFile(file); sources.set(file, value); }
    return value;
  };
  function fail(file: string, node: t.Node, message: string): never {
    throw new PropsSchemaError(file, node.loc?.start.line ?? 1, (node.loc?.start.column ?? 0) + 1, message);
  }
  type Target = {identity:string;file:string;source:string;fn:ComponentFunction;mode:IslandRenderMode};
  const targets = new Map<string,Target | undefined>();
  const target = (local: string, file: string): Target | undefined => {
    file=realpathSync(file);
    const cacheKey = `${file}\0${local}`;
    if (targets.has(cacheKey)) return targets.get(cacheKey);
    targets.set(cacheKey, undefined);
    // Resolve a module-local import to its exported binding before asking the
    // function resolver. The declaration's path/position is the identity.
    let inputFile = file, inputName = local;
    const ast = parse(source(file), {sourceType:'module',plugins:['typescript','jsx']});
    const imported = readImportBindings(ast).get(local);
    if (imported) {
      if (imported.kind === 'type' || imported.imported === '*') { targets.set(cacheKey, undefined); return undefined; }
      const loaded = rawModuleLoader(file, imported.source);
      if (!loaded) { targets.set(cacheKey, undefined); return undefined; }
      inputFile = loaded.path; inputName = imported.imported;
    }
    const found = resolveExportedFunction(source(inputFile), inputFile, inputName, {loadModule:rawModuleLoader,allowLocal:!imported});
    let result: Target | undefined;
    if (found.kind === 'found') result = {identity:`${found.filePath}\0${found.fn.start}`,file:found.filePath,source:found.source,fn:found.fn,mode:'ssr'};
    else {
      const browser = findBrowserOnlyDeclaration(local, file, {sourceOf:source,loadModule:rawModuleLoader});
      if (browser) {
        const impl = browser.call.arguments[0];
        let fn: ComponentFunction | undefined, owner = browser.file;
        if (callable(impl)) fn = impl;
        else if (t.isIdentifier(impl)) {
          const resolved = target(impl.name, owner);
          if (resolved) { fn = resolved.fn; owner = resolved.file; }
        }
        if (!fn) fail(browser.file, browser.call, 'browserOnly needs a resolvable function with declared props');
        result = {identity:`${browser.file}\0browser:${browser.call.start}`,file:owner,source:source(owner),fn,mode:'browserOnly'};
      }
    }
    targets.set(cacheKey, result); return result;
  };
  const registered = new Map<string,RegisteredIsland>(), names = new Set<string>();
  const proveRoot=createIslandRootProofs(rawModuleLoader,identity=>registered.has(identity));
  const entries: {island:RegisteredIsland;local:string;start:number;end:number}[]=[];
  const registry: IslandRegistry = {entries:()=>entries,resolve(local,file) { const found = target(local,file); return found ? registered.get(found.identity) : undefined; }};
  const ast = parse(source(entry), {sourceType:'module',plugins:['typescript','jsx']});
  traverse(ast, { CallExpression(path) {
    if (!isCoreCall(path, 'activateIslands')) return;
    const arg = path.node.arguments[0];
    if (!t.isObjectExpression(arg)) fail(entry, path.node, 'activateIslands needs a literal registry');
    for (const property of arg.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isIdentifier(property.value) || key(property.key) === undefined) fail(entry, property, 'island registrations need literal names and component identifiers');
      const name = key(property.key)!, local = path.scope.getBinding(property.value.name);
      if (!local?.scope.path.isProgram() || local.constantViolations.length) fail(entry, property, 'island registration must name an immutable module binding');
      const found = target(property.value.name, entry);
      if (!found) fail(entry, property, `cannot resolve registered island ${name}`);
      if (registered.has(found.identity) || names.has(name)) fail(entry, property, `ambiguous duplicate island registration ${name}`);
      const declared = readFunctionProps(found.fn, found.file);
      // Reserved keys and canonical bounds fail at the declaration, before any
      // host or partially valid contract is emitted.
      try { canonicalIslandSchema(declared.schema, 0); }
      catch (error) { fail(found.file, found.fn, String(error)); }
      let analyzed: IslandBindings | undefined;
      const item: RegisteredIsland = {...found,name,declared,proveRoot() { if(found.mode==='ssr') proveRoot(found.source,found.file,found.fn); },analyze() {
        return analyzed ??= analyzeIslandBindings(found.source, found.file, name, {
          functionStart:found.fn.start ?? undefined,props:declared.schema[0]!.map(field=>field.name),mode:found.mode,loadModule:rawModuleLoader,
          registration:(file,local)=>registry.resolve(local,file)?.name,
          childFields:(name)=>[...registered.values()].find(child=>child.name===name)?.declared.schema[0]!.map(field=>({name:field.name,optional:field.type.kind==='optional'})) ?? [],
        });
      }};
      registered.set(found.identity,item); names.add(name);
      entries.push({island:item,local:property.value.name,start:property.start!,end:property.end!});
    }
  }});
  return registry;
}
