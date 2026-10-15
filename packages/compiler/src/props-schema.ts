import {readSourceFile} from './source-snapshot';
/** Declared page data is read before JSX lowering erases TypeScript annotations. */

import { dirname, relative, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { resolveExportedFunction, readImportBindings, type ComponentFunction } from './export-resolver';
import { resolveFilePath, type ModuleLoader } from './module-loader';
import { encodePropsSchema, type PropsSchema, type SchemaField, type SchemaType } from './fmir-payload';
import { MAX_SCHEMA_ITEMS, MAX_TYPE_DEPTH } from './fmir-constants';

export type PropsParameter = { kind: 'none' } | { kind: 'named'; name: string }
  | { kind: 'destructured'; fields: [string, string][] };
export interface DeclaredPageProps { schema: PropsSchema; parameter: PropsParameter }

/** A declared contract can never degrade to placeholder output. */
export class PropsSchemaError extends Error {
  constructor(readonly file: string, readonly line: number, readonly column: number, detail: string, readonly code: 'BUILD-610' | 'BUILD-612' | 'BUILD-613' = 'BUILD-610') {
    super(`${code} ${file}:${line}:${column}: ${detail}`);
    this.name = 'PropsSchemaError';
  }
}
function fail(file: string, node: t.Node, detail: string): never {
  throw new PropsSchemaError(file, node.loc?.start.line ?? 1, (node.loc?.start.column ?? 0) + 1, detail);
}
function nameOf(node: t.Node): string | undefined {
  return t.isIdentifier(node) ? node.name : t.isStringLiteral(node) ? node.value : undefined;
}

/** Empty-parameter pages have an empty contract; a parameter must declare its type. */
export function readPageProps(file: string, exportedName: string): DeclaredPageProps {
  // Resolved imports already use canonical paths. Keep the entry root in the
  // same coordinate system so symlinked checkouts do not invent ../../ paths.
  file=realpathSync(file);
  const raw: ModuleLoader = (from, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const path = resolveFilePath(dirname(from), specifier);
    return path ? { path, source: readSourceFile(path) } : null;
  };
  const found = resolveExportedFunction(readSourceFile(file), file, exportedName, { loadModule: raw, allowLocal: true });
  if (found.kind !== 'found') throw new PropsSchemaError(file, 1, 1, `cannot resolve declared page: ${found.detail}`);
  return readFunctionProps(found.fn, found.filePath, dirname(resolve(file)));
}

/** A browserOnly implementation has a declared input schema even though its body is client-only. */
export function readFunctionProps(fn: ComponentFunction, file: string, root = dirname(resolve(file))): DeclaredPageProps {
  const found = { filePath: file };
  if (!fn.params.length) return { schema: [[]], parameter: { kind: 'none' } };
  if (fn.params.length !== 1) fail(found.filePath, fn, 'a page takes exactly one declared props parameter');
  const param = fn.params[0]!;
  if (!t.isIdentifier(param) && !t.isObjectPattern(param)) fail(found.filePath, param, 'props must be a named or directly destructured parameter');
  const annotation = param.typeAnnotation;
  if (!t.isTSTypeAnnotation(annotation)) fail(found.filePath, param, 'the page props parameter needs a declared TypeScript object type');
  let parameter: PropsParameter;
  if (t.isIdentifier(param)) parameter = { kind: 'named', name: param.name };
  else {
    const fields: [string, string][] = [];
    for (const field of param.properties) {
      if (!t.isObjectProperty(field) || field.computed || !t.isIdentifier(field.value)) fail(found.filePath, field, 'props destructuring supports explicit fields and aliases, without rest or defaults');
      const name = nameOf(field.key);
      if (name === undefined) fail(found.filePath, field, 'props field must have a literal name');
      fields.push([name, field.value.name]);
    }
    parameter = { kind: 'destructured', fields };
  }
  const reader = new SchemaReader(root);
  const type = reader.type(annotation.typeAnnotation, found.filePath, 0);
  if (type.kind !== 'object' || type.object !== 0) fail(found.filePath, annotation, 'page props must be an object type');
  if (parameter.kind === 'destructured') for (const [name] of parameter.fields) {
    if (!reader.objects[0]!.some(field => field.name === name)) fail(found.filePath, param, `destructured field ${name} is absent from the declared props`);
  }
  // Exercise the same wire encoder here so a rejected schema cannot escape as
  // a generic placeholder-producing emission error later in the pipeline.
  try {
    const strings = new Map<string, number>();
    encodePropsSchema(reader.objects, text => {
      if (new TextEncoder().encode(text).length > 65535) throw new Error('props schema string exceeds the FMIR string limit');
      if (!strings.has(text)) strings.set(text, strings.size);
      return strings.get(text)!;
    });
  } catch (error) { fail(found.filePath, annotation, `unrepresentable props schema: ${String(error)}`); }
  return { schema: reader.objects, parameter };
}

type Definition = { node: t.Node; file: string };
class SchemaReader {
  readonly objects: SchemaField[][] = [];
  private readonly asts = new Map<string, t.File>();
  private readonly objectIds = new Map<t.Node, number>();
  private readonly active = new Set<t.Node>();
  constructor(private readonly root: string) {}

  private ast(file: string): t.File {
    let ast = this.asts.get(file);
    if (!ast) {
      ast = parse(readSourceFile(file), { sourceType: 'module', plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? ['jsx' as const] : [])] });
      this.asts.set(file, ast);
    }
    return ast;
  }
  private imported(file: string, specifier: string, name: string, at: t.Node, visited: Set<string>): Definition {
    if (!specifier.startsWith('.')) fail(file, at, 'props types must be declared locally or imported from a relative source file');
    const path = resolveFilePath(dirname(file), specifier);
    if (!path) fail(file, at, `cannot resolve props type import ${specifier}`);
    return this.definition(path, name, at, true, visited);
  }
  private definition(file: string, name: string, at: t.Node, exported = false, visited = new Set<string>()): Definition {
    const key = `${file}\0${name}\0${exported}`;
    if (visited.has(key) || visited.size > MAX_SCHEMA_ITEMS) fail(file, at, `cyclic or excessive type resolution for ${name}`);
    const next = new Set(visited); next.add(key);
    const ast = this.ast(file);
    for (const statement of ast.program.body) {
      const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
      if (declaration && (t.isTSTypeAliasDeclaration(declaration) || t.isTSInterfaceDeclaration(declaration) || t.isClassDeclaration(declaration))
        && declaration.id?.name === name && (!exported || t.isExportNamedDeclaration(statement))) return { node: declaration, file };
      if (exported && t.isExportNamedDeclaration(statement)) {
        for (const specifier of statement.specifiers) if (t.isExportSpecifier(specifier) && nameOf(specifier.exported) === name) {
          const local = nameOf(specifier.local)!;
          return statement.source ? this.imported(file, statement.source.value, local, at, next) : this.definition(file, local, at, false, next);
        }
      }
    }
    if (!exported) {
      const imported = readImportBindings(ast).get(name);
      if (imported) return this.imported(file, imported.source, imported.imported, at, next);
    }
    fail(file, at, `unsupported or unresolved props type ${name}`);
  }

  type(node: t.Node, file: string, depth: number): SchemaType {
    if (depth > MAX_TYPE_DEPTH) fail(file, node, 'props type nesting exceeds the FMIR limit');
    if (this.active.has(node)) fail(file, node, 'recursive props types are not supported');
    this.active.add(node);
    try {
      if (t.isTSStringKeyword(node)) return { kind: 'string' };
      if (t.isTSNumberKeyword(node)) return { kind: 'number' };
      if (t.isTSBooleanKeyword(node)) return { kind: 'boolean' };
      if (t.isTSParenthesizedType(node)) return this.type(node.typeAnnotation, file, depth);
      if (t.isTSArrayType(node)) return { kind: 'array', element: this.type(node.elementType, file, depth + 1) };
      if (t.isTSLiteralType(node) && t.isStringLiteral(node.literal)) return { kind: 'enum', variants: [node.literal.value] };
      if (t.isTSUnionType(node)) {
        const nullable = node.types.filter(type => t.isTSNullKeyword(type));
        const rest = node.types.filter(type => !t.isTSNullKeyword(type));
        let inner: SchemaType;
        if (rest.length && rest.every(type => t.isTSLiteralType(type) && t.isStringLiteral(type.literal))) {
          inner = { kind: 'enum', variants: [...new Set(rest.map(type => (type as t.TSLiteralType).literal as t.StringLiteral).map(literal => literal.value))] };
        } else if (nullable.length && rest.length === 1) inner = this.type(rest[0]!, file, depth + 1);
        else fail(file, node, 'only string-literal unions and T | null are supported props unions');
        return nullable.length && inner.kind !== 'optional' ? { kind: 'optional', inner } : inner;
      }
      if (t.isTSTypeReference(node)) {
        if (!t.isIdentifier(node.typeName) || node.typeParameters) fail(file, node, 'generic or namespace props types are not supported; use T[] for arrays');
        const name = node.typeName.name;
        // Date is the one global class in the closed set. A local declaration
        // or import named Date must resolve normally, never acquire this meaning.
        const ast = this.ast(file);
        const shadowed = readImportBindings(ast).has(name) || ast.program.body.some(statement => {
          const d = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
          return d && 'id' in d && t.isIdentifier(d.id) && d.id.name === name;
        });
        if (name === 'Date' && !shadowed) return { kind: 'date' };
        const found = this.definition(file, name, node);
        if (t.isClassDeclaration(found.node)) fail(file, node, 'class instances are not supported props; declare an object type');
        return this.type(found.node, found.file, depth);
      }
      if (t.isTSTypeAliasDeclaration(node)) {
        if (node.typeParameters) fail(file, node, 'generic props aliases are not supported');
        return this.type(node.typeAnnotation, file, depth);
      }
      if (t.isTSTypeLiteral(node) || t.isTSInterfaceDeclaration(node)) {
        if (t.isTSInterfaceDeclaration(node) && (node.typeParameters || node.extends?.length)) fail(file, node, 'declare props interface fields directly, without generic parameters or extends');
        const known = this.objectIds.get(node);
        if (known !== undefined) return { kind: 'object', object: known };
        if (this.objects.length >= MAX_SCHEMA_ITEMS) fail(file, node, 'too many props object types');
        const id = this.objects.length, fields: SchemaField[] = [];
        this.objects.push(fields); this.objectIds.set(node, id);
        for (const member of t.isTSTypeLiteral(node) ? node.members : node.body.body) {
          if (!t.isTSPropertySignature(member) || member.computed || !member.typeAnnotation) fail(file, member, 'props objects allow explicitly typed fields, not index signatures or methods');
          const name = nameOf(member.key);
          if (name === undefined) fail(file, member, 'props field must have a literal name');
          if (fields.some(field => field.name === name)) fail(file, member, `duplicate props field ${name}`);
          if (fields.length >= MAX_SCHEMA_ITEMS) fail(file, member, 'too many props fields');
          // Each field starts a fresh wrapper chain; object graph depth has its
          // separate object-count/cycle bounds in the existing FMIR contract.
          let type = this.type(member.typeAnnotation.typeAnnotation, file, 0);
          if (member.optional && type.kind !== 'optional') type = { kind: 'optional', inner: type };
          let wrappers = 0, wrapped = type;
          while (wrapped.kind === 'array' || wrapped.kind === 'optional') {
            wrappers++;
            wrapped = wrapped.kind === 'array' ? wrapped.element : wrapped.inner;
          }
          if (wrappers > MAX_TYPE_DEPTH) fail(file, member, 'props type nesting exceeds the FMIR limit');
          fields.push({ name, file: relative(this.root, file).replaceAll('\\', '/'), line: member.loc?.start.line ?? 1, column: (member.loc?.start.column ?? 0) + 1, type });
        }
        return { kind: 'object', object: id };
      }
      fail(file, node, `unsupported props type ${node.type}`);
    } finally { this.active.delete(node); }
  }
}
