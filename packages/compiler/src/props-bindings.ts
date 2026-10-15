import {readSourceFile} from './source-snapshot';
/** Root data slots use declared names. Nested reads use FMIR's existing PROP. */
import * as t from '@babel/types';
import _traverse, { type Binding } from '@babel/traverse';
import { parse } from '@babel/parser';

import { readImportBindings } from './export-resolver';
import { originalPosition } from './diagnostics';
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;
import { IrEmitContext } from './ir-emit';
import * as C from './fmir-constants';
import type { PropsSchema, SchemaType } from './fmir-payload';
import type { ComponentFunction } from './export-resolver';
import { PropsSchemaError, type DeclaredPageProps } from './props-schema';
import { closedExpression, constantAssignable, schemaHint } from './closed-expression';

type Path = readonly string[];
export interface PropsScope {
  schema: PropsSchema;
  roots: Map<string, number>;
  aliases: Map<string, Path>;
  objects: Map<string, Map<string, Path>>;
  /** Separate getter identities even when their initial server value is shared.
   * FORMA-103 must keep those identities when producing activation state. */
  signals: Map<string, Path>;
  file: string;
  references: WeakMap<t.Identifier, Binding>;
  bindings: Map<string, Binding>;
  views: Map<string, { slot: number; type: SchemaType }>;
  signalImports: Set<string>;
  unsupported: Map<string, t.Node>;
}
function invalid(scope: PropsScope, node: t.Node, message: string): never {
  const at = originalPosition(scope.file, node.loc?.start ?? { line: 1, column: 0 });
  throw new PropsSchemaError(scope.file, at.line, at.column, message);
}
function unwrap(node: t.Node): t.Node {
  if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node) || t.isTSNonNullExpression(node) || t.isParenthesizedExpression(node)) return unwrap(node.expression);
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    if (node.params.length) return node;
    if (!t.isBlockStatement(node.body)) return unwrap(node.body);
    if (node.body.body.length === 1 && t.isReturnStatement(node.body.body[0]) && node.body.body[0].argument) return unwrap(node.body.body[0].argument);
  }
  return node;
}
function localName(node: t.Identifier, scope: PropsScope): string | undefined {
  const binding = scope.references.get(node);
  return binding && binding === scope.bindings.get(node.name) ? node.name : undefined;
}
export function propPath(node: t.Node | null | undefined, scope: PropsScope | undefined): Path | undefined {
  if (!node || !scope) return undefined;
  node = unwrap(node);
  if (t.isIdentifier(node)) { const name = localName(node, scope); if (name && scope.unsupported.has(name)) invalid(scope, node, `computed declared prop binding ${name} is outside the SSR subset; pass its rendered value from the handler`); return name ? scope.aliases.get(name) ?? scope.signals.get(name) : undefined; }
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    if (node.arguments.length === 0) { const name = localName(node.callee, scope); if (name && scope.unsupported.has(name)) invalid(scope, node, `computed declared prop binding ${name} is outside the SSR subset`); return name ? scope.signals.get(name) : undefined; }
    if ((node.callee.name === 'String' || node.callee.name === 'Number') && node.arguments.length === 1 && !t.isSpreadElement(node.arguments[0])) {
      const path = propPath(node.arguments[0], scope);
      if (path) invalid(scope, node, `${node.callee.name}(declared prop) coercion is not in the SSR subset; pass the rendered value as a declared prop`);
    }
  }
  if (t.isOptionalMemberExpression(node)) {
    if(node.optional&&t.isIdentifier(node.object)&&localName(node.object,scope)&&scope.objects.has(node.object.name)) {
      const key=!node.computed&&t.isIdentifier(node.property)?node.property.name:t.isStringLiteral(node.property)?node.property.value:undefined;
      if(key===undefined)invalid(scope,node,'a declared prop requires a literal field name');
      const path=scope.objects.get(node.object.name)!.get(key);
      if(!path)invalid(scope,node,`field ${key} is absent from the declared props`);
      return path;
    }
    return undefined;
  }
  if (t.isMemberExpression(node)) {
    const key = !node.computed && t.isIdentifier(node.property) ? node.property.name : t.isStringLiteral(node.property) ? node.property.value : undefined;
    if (t.isIdentifier(node.object) && localName(node.object, scope) && scope.objects.has(node.object.name)) {
      if (key === undefined) invalid(scope, node, 'a declared prop requires a literal field name');
      const path = scope.objects.get(node.object.name)!.get(key);
      if (!path) invalid(scope, node, `field ${key} is absent from the declared props`);
      return path;
    }
    const parent = propPath(node.object, scope);
    if (parent) {
      if (key === undefined) invalid(scope, node, 'a declared prop requires a literal field name');
      return [...parent, key];
    }
  }
  return undefined;
}
function inner(type: SchemaType): SchemaType { return type.kind === 'optional' ? inner(type.inner) : type; }
function hint(type: SchemaType): number {
  switch (inner(type).kind) {
    case 'boolean': return C.SLOT_TYPE_BOOL;
    case 'number': case 'date': return C.SLOT_TYPE_NUMBER;
    case 'array': return C.SLOT_TYPE_ARRAY;
    case 'object': return C.SLOT_TYPE_OBJECT;
    default: return C.SLOT_TYPE_TEXT;
  }
}
export function propType(path: Path, scope: PropsScope, at: t.Node): SchemaType {
  const view = scope.views.get(path[0]!);
  let type: SchemaType = view?.type ?? { kind: 'object', object: 0 };
  for (const part of view ? path.slice(1) : path) {
    const parent = inner(type);
    if (parent.kind !== 'object') invalid(scope, at, `cannot read ${part} from ${parent.kind} in declared prop ${path.join('.')}`);
    const field = scope.schema[parent.object]!.find(field => field.name === part);
    if (!field) invalid(scope, at, `field ${path.join('.')} is absent from the declared props`);
    type = field.type;
  }
  return type;
}
/** Emit reads at the point of use: a branch must not depend on another branch's temporaries. */
export function propSlot(node: t.Node | null | undefined, scope: PropsScope | undefined, ctx: IrEmitContext, use: 'value' | 'attribute' | 'text' = 'value'): number | undefined {
  const path = propPath(node, scope);
  if (!path || !scope || !node) {
    if (scope && node) {
      const expression = unwrap(node);
      if (t.isBinaryExpression(expression) || t.isLogicalExpression(expression) || t.isUnaryExpression(expression) || t.isTemplateLiteral(expression) || t.isOptionalMemberExpression(expression)) {
        const contains = (part: t.Node): boolean => {
          if (propPath(part, scope)) return true;
          return (t.VISITOR_KEYS[part.type] ?? []).some(key => {
            const child = (part as any)[key];
            return (Array.isArray(child) ? child : [child]).some(item => item?.type && contains(item));
          });
        };
        if (contains(expression)) invalid(scope, expression, 'computed declared prop expressions are outside the SSR subset; pass the result as a declared prop');
      }
    }
    return undefined;
  }
  const type = inner(propType(path, scope, node));
  if (use !== 'value' && ['array', 'object', 'date'].includes(type.kind)) invalid(scope, node, `a declared ${type.kind} cannot be used directly as ${use}; pass a rendered string or read a scalar field`);
  let slot = scope.views.get(path[0]!)?.slot ?? scope.roots.get(path[0]!);
  if (slot === undefined) invalid(scope, node, `missing declared root binding ${path[0]}`);
  for (let i = 1; i < path.length; i++) {
    const target = ctx.addTemporarySlot(hint(propType(path.slice(0, i + 1), scope, node)));
    ctx.emit(C.OP_PROP); ctx.emitU16(slot); ctx.emitU32(ctx.addString(path[i]!)); ctx.emitU16(target);
    ctx.recordClosedProjection(slot,path[i]!,target);
    slot = target;
  }
  ctx.recordSlotRef(slot);
  return slot;
}
function bindParameter(scope: PropsScope, param: t.Node | undefined, fields: Map<string, Path>): void {
  if (t.isIdentifier(param)) scope.objects.set(param.name, fields);
  else if (t.isObjectPattern(param)) for (const field of param.properties) {
    if (t.isObjectProperty(field) && !field.computed && t.isIdentifier(field.value)) {
      const key = t.isIdentifier(field.key) ? field.key.name : t.isStringLiteral(field.key) ? field.key.value : undefined;
      const path = key === undefined ? undefined : fields.get(key);
      if (path) scope.aliases.set(field.value.name, path);
    }
  }
}
function indexBindings(scope: PropsScope, fn: ComponentFunction): void {
  // Index actual Babel bindings, not identifier spelling: an inner parameter or
  // block local cannot accidentally acquire its outer namesake's handler data.
  const file = t.file(t.program(t.isFunctionDeclaration(fn) ? [fn] : [t.expressionStatement(fn)]));
  traverse(file, {
    Function(path) {
      if (path.node === fn) for (const [name, binding] of Object.entries(path.scope.bindings)) scope.bindings.set(name, binding);
    },
    ReferencedIdentifier(path) {
      const binding = path.scope.getBinding(path.node.name);
      if (binding && t.isIdentifier(path.node)) scope.references.set(path.node, binding);
    },
  });
}
function validateBindings(scope: PropsScope, fn: ComponentFunction): void {
  for (const name of [...scope.aliases.keys(), ...scope.objects.keys(), ...scope.signals.keys()]) {
    const binding = scope.bindings.get(name);
    if (binding?.constantViolations.length) invalid(scope, binding.constantViolations[0]!.node, `declared prop binding ${name} is reassigned; pass an immutable value to SSR`);
  }
  const visit = (node: t.Node): void => {
    if (t.isAssignmentExpression(node) || t.isUpdateExpression(node)) {
      const target = t.isAssignmentExpression(node) ? node.left : node.argument;
      if (propPath(target, scope)) invalid(scope, node, 'declared prop data is mutated; SSR props must remain immutable');
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const value = (node as any)[key];
      for (const child of Array.isArray(value) ? value : [value]) if (child?.type) visit(child);
    }
  };
  visit(fn.body);
}
function declarations(scope: PropsScope, fn: ComponentFunction, ctx?: IrEmitContext): void {
  if (!t.isBlockStatement(fn.body)) return;
  for (const statement of fn.body.body) if (t.isVariableDeclaration(statement)) for (const declaration of statement.declarations) {
    if (!declaration.init) continue;
    if (t.isIdentifier(declaration.id)) {
      if (t.isIdentifier(declaration.init) && localName(declaration.init, scope) && scope.objects.has(declaration.init.name)) {
        scope.objects.set(declaration.id.name, scope.objects.get(declaration.init.name)!);
      } else {
        const path = propPath(declaration.init, scope);
        if (path) scope.aliases.set(declaration.id.name, path);
        else if (containsDeclared(declaration.init, scope)) scope.unsupported.set(declaration.id.name, declaration.init);
      }
    } else if (t.isArrayPattern(declaration.id) && t.isIdentifier(declaration.id.elements[0]) && t.isCallExpression(declaration.init)
      && t.isIdentifier(declaration.init.callee) && scope.signalImports.has(declaration.init.callee.name)
      && !scope.references.has(declaration.init.callee) && declaration.init.arguments[0]) {
      const initial = unwrap(declaration.init.arguments[0]);
      let path = propPath(initial, scope);
      if (!path && ctx && t.isLogicalExpression(initial) && initial.operator === '??') {
        const sourcePath = propPath(initial.left, scope);
        if (sourcePath) {
          const sourceType = propType(sourcePath, scope, initial.left), targetType = inner(sourceType);
          const fallback = closedExpression(initial.right, scope.file);
          if (!constantAssignable(fallback, targetType, scope.schema)) invalid(scope, initial.right, 'nullish fallback does not match the declared non-null type');
          const source = propSlot(initial.left, scope, ctx)!;
          if (sourceType.kind !== 'optional') path = sourcePath;
          else {
            const closed = ctx.constantSlot(source);
            let target: number;
            if (closed) {
              // A literal null input has no native T provenance. Fold it here;
              // an optional schema annotation cannot manufacture that provenance.
              target = closed.value === null ? ctx.addConstantSlot(fallback, schemaHint(targetType)) : source;
            } else {
              const value = ctx.addConstantSlot(fallback, schemaHint(targetType));
              target = ctx.addTemporarySlot(schemaHint(targetType));
              ctx.emit(C.OP_COALESCE); ctx.emitU16(source); ctx.emitU16(value); ctx.emitU16(target);
            }
            const key = `\0coalesce:${target}`;
            scope.views.set(key, {slot:target,type:targetType}); path = [key];
          }
        }
      }
      if (path) scope.signals.set(declaration.id.elements[0].name, path);
      else if (containsDeclared(declaration.init.arguments[0], scope)) scope.unsupported.set(declaration.id.elements[0].name, declaration.init);
    } else if (t.isObjectPattern(declaration.id) && containsDeclared(declaration.init, scope)) {
      for (const field of declaration.id.properties) if (t.isObjectProperty(field) && t.isIdentifier(field.value)) scope.unsupported.set(field.value.name, declaration.init);
    }
  }
}
export function rootPropsScope(declared: DeclaredPageProps, fn: ComponentFunction, file: string, ctx: IrEmitContext): PropsScope | undefined {
  const ast = parse(readSourceFile(file), { sourceType: 'module', plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? ['jsx' as const] : [])] });
  const signalImports = new Set([...readImportBindings(ast)].filter(([, binding]) => binding.imported === 'createSignal' && ['@getforma/core', 'formajs'].includes(binding.source)).map(([name]) => name));
  const scope: PropsScope = { schema: ctx.getPropsSchema(), roots: new Map(), aliases: new Map(), objects: new Map(), signals: new Map(), file, references: new WeakMap(), bindings: new Map(), views: new Map(), signalImports, unsupported: new Map() };
  indexBindings(scope, fn);
  const fields = new Map<string, Path>();
  for (const field of declared.schema[0]!) {
    scope.roots.set(field.name, ctx.addSlot(field.name, hint(field.type), C.SLOT_SOURCE_SERVER, undefined, false));
    fields.set(field.name, [field.name]);
  }
  if (declared.parameter.kind === 'named') scope.objects.set(declared.parameter.name, fields);
  else if (declared.parameter.kind === 'destructured') for (const [field, local] of declared.parameter.fields) scope.aliases.set(local, [field]);
  declarations(scope, fn, ctx);
  validateBindings(scope, fn);
  return scope;
}
export function childPropsScope(parent: PropsScope | undefined, fn: ComponentFunction, arg: t.Node | undefined, file: string, ctx?: IrEmitContext): PropsScope | undefined {
  if (!parent) return undefined;
  const ast = parse(readSourceFile(file), { sourceType: 'module', plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? ['jsx' as const] : [])] });
  const signalImports = new Set([...readImportBindings(ast)].filter(([, binding]) => binding.imported === 'createSignal' && ['@getforma/core', 'formajs'].includes(binding.source)).map(([name]) => name));
  const scope: PropsScope = { ...parent, aliases: new Map(), objects: new Map(), signals: new Map(), file, references: new WeakMap(), bindings: new Map(), signalImports, unsupported: new Map() };
  indexBindings(scope, fn);
  const fields = new Map<string, Path>();
  if (t.isIdentifier(arg) && localName(arg, parent) && parent.objects.has(arg.name)) {
    for (const [name, path] of parent.objects.get(arg.name)!) fields.set(name, path);
  } else if (t.isObjectExpression(arg)) for (const field of arg.properties) {
    if (t.isObjectProperty(field) && !field.computed) {
      const name = t.isIdentifier(field.key) ? field.key.name : t.isStringLiteral(field.key) ? field.key.value : undefined;
      const path = propPath(field.value, parent);
      if (name !== undefined && path) fields.set(name, path);
    }
  }
  bindParameter(scope, fn.params[0], fields);
  declarations(scope, fn, ctx);
  validateBindings(scope, fn);
  return scope;
}

/** Declared island fields point at this occurrence's prepared input slots. */
export function islandPropsScope(fn: ComponentFunction, file: string, ctx: IrEmitContext, schemaObject: number, inputs: readonly number[]): PropsScope {
  const ast = parse(readSourceFile(file), {sourceType:'module',plugins:['typescript',...(/\.[jt]sx$/.test(file)?['jsx' as const]:[])]});
  const signalImports = new Set([...readImportBindings(ast)].filter(([,binding])=>binding.imported==='createSignal'&&['@getforma/core','formajs'].includes(binding.source)).map(([name])=>name));
  const scope: PropsScope = {schema:ctx.getPropsSchema(),roots:new Map(),aliases:new Map(),objects:new Map(),signals:new Map(),file,references:new WeakMap(),bindings:new Map(),views:new Map(),signalImports,unsupported:new Map()};
  indexBindings(scope,fn);
  const fields = new Map<string,Path>();
  for (const [index,field] of scope.schema[schemaObject]!.entries()) {
    const slot=inputs[index]!,key=`\0island:${schemaObject}:${index}:${slot}`;
    scope.views.set(key,{slot,type:field.type}); fields.set(field.name,[key]);
  }
  bindParameter(scope,fn.params[0],fields); declarations(scope,fn,ctx); validateBindings(scope,fn);
  return scope;
}

export function listItemHint(scope:PropsScope,source:t.Node):number {
  const path=propPath(source,scope);if(!path)invalid(scope,source,'missing declared list source');
  const type=inner(propType(path,scope,source));
  if(type.kind!=='array')invalid(scope,source,'createList declared source must have an array type');
  return hint(type.element);
}

/** A row uses its own local projection root, never a handler-addressed slot. */
export function listPropsScope(parent: PropsScope, fn: ComponentFunction, source: t.Node, itemSlot: number): PropsScope {
  const path = propPath(source, parent);
  if (!path) return parent;
  const type = inner(propType(path, parent, source));
  if (type.kind !== 'array') invalid(parent, source, 'createList declared source must have an array type');
  const scope: PropsScope = { ...parent, aliases: new Map(parent.aliases), objects: new Map(parent.objects), signals: new Map(parent.signals), bindings: new Map(parent.bindings), views: new Map(parent.views), unsupported: new Map(parent.unsupported) };
  indexBindings(scope, fn);
  const param = fn.params[0];
  if (!t.isIdentifier(param)) invalid(scope, fn, 'declared list rows need a named parameter');
  // This key exists only in the compiler's lexical environment, never on wire.
  const key = `\0row:${itemSlot}`;
  scope.views.set(key, { slot: itemSlot, type: type.element });
  scope.aliases.set(param.name, [key]);
  scope.objects.delete(param.name); scope.signals.delete(param.name);
  declarations(scope, fn); validateBindings(scope, fn);
  return scope;
}

/** Boolean children are omitted by core's h(), for direct and reactive reads. */
export function emitPropText(node: t.Node, scope: PropsScope | undefined, ctx: IrEmitContext): boolean {
  const path = propPath(node, scope);
  if (path && scope && inner(propType(path, scope, node)).kind === 'boolean') return true;
  const slot = propSlot(node, scope, ctx, 'text');
  if (slot === undefined) return false;
  ctx.emit(C.OP_DYN_TEXT); ctx.emitU16(slot); ctx.emitU16(ctx.nextMarker());
  return true;
}

function containsDeclared(node: t.Node, scope: PropsScope): boolean {
  if (propPath(node, scope)) return true;
  if (t.isIdentifier(node) && localName(node, scope) && scope.objects.has(node.name)) return true;
  return (t.VISITOR_KEYS[node.type] ?? []).some(key => {
    const child = (node as any)[key];
    return (Array.isArray(child) ? child : [child]).some(item => item?.type && containsDeclared(item, scope));
  });
}
/** A successful fallback must never discard declared handler data. */
export function refuseDeclaredFallback(node: t.Node | null | undefined, scope: PropsScope | undefined): void {
  if (scope && node && containsDeclared(node, scope)) invalid(scope, node, 'this declared prop expression is outside the SSR subset; pass a rendered scalar or use direct fields, createShow and createList');
}
