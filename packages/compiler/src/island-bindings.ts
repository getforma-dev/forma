/** Resolve semantic binding identities from original component source, before JSX
 * lowering can round an integer literal or erase lexical/type information. */
import { parse } from '@babel/parser';
import _traverse, { type Binding, type Scope } from '@babel/traverse';
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
import * as t from '@babel/types';
import { encodeBindings, encodeClosedConstant, type BindingRecord, type BindingValue, type BinaryBindingOperator, type IslandRenderMode, type UnaryBindingOperator } from './fmir-contracts';
import { resolveExportedFunction, resolveExportedSignal, resolveImportedConstant, returnExpressionOf, type ComponentFunction, type ResolvedExport } from './export-resolver';
import type { ModuleLoader } from './module-loader';
import { PropsSchemaError } from './props-schema';
import * as C from './fmir-constants';

export interface IslandBindingOptions {
  props: readonly string[];
  /** Exact original declaration selected by the registration resolver. */
  functionStart?: number;
  mode?: IslandRenderMode;
  loadModule?: ModuleLoader;
  islands?: ReadonlySet<string>;
  /** Production resolves registry entries to actual lexical/import declarations. */
  registration?: (file: string, localName: string) => string | undefined;
  childFields?: (name: string, file: string) => readonly { name: string; optional: boolean }[];
}
/** Source associations are compilation bookkeeping, never part of canonical bytes. */
export interface LocalSignalIdentity { ordinal: number; getter: string; setter?: string; file: string; start: number; end: number }
export interface CapturedSignalIdentity { ordinal: number; getter: string; file: string; start: number }
export interface IslandBindings { bindings: BindingRecord[]; locals: LocalSignalIdentity[]; captures: CapturedSignalIdentity[] }
interface Module {
  file: string; source: string; ast: t.File; scope: Scope;
  references: WeakMap<t.Node, Binding>; scopes: WeakMap<t.Node, Scope>;
  functions: Map<string, ComponentFunction>;
}
interface Environment {
  module: Module;
  values: Map<Binding, DeferredValue>;
  objects: Map<Binding, Map<string, DeferredValue>>;
  functions: Set<t.Node>;
  staticRows: Set<Binding>;
}
type DeferredValue = BindingValue | (() => BindingValue);
function resolved(value: DeferredValue): BindingValue { return typeof value === 'function' ? value() : value; }
interface Signal { binding: Binding; module: Module; declaration: t.VariableDeclarator; initial: t.Expression }
const functionKey = (node: t.Node): string => `${node.start}:${node.end}:${node.type}`;
function isFunction(node: t.Node | null | undefined): node is ComponentFunction { return t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node); }
function unwrap(node: t.Node): t.Node {
  while (t.isTSAsExpression(node) || t.isTSTypeAssertion(node) || t.isTSNonNullExpression(node) || t.isTSSatisfiesExpression(node) || t.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
function name(node: t.Node): string | undefined { return t.isIdentifier(node) || t.isJSXIdentifier(node) ? node.name : t.isStringLiteral(node) ? node.value : undefined; }
function fail(module: Module, at: t.Node, message: string): never { throw new PropsSchemaError(module.file, at.loc?.start.line ?? 1, (at.loc?.start.column ?? 0) + 1, message); }
function scalar(node: t.Node): boolean { return t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node); }

export function analyzeIslandBindings(source: string, file: string, exportedName: string, options: IslandBindingOptions): IslandBindings {
  if (options.mode === 'browserOnly') return { bindings: [], locals: [], captures: [] };
  const modules = new Map<string, Module>(), moduleOf = new WeakMap<Binding, Module>();
  const captures: CapturedSignalIdentity[] = [], captureValues: unknown[] = [], captureIds = new Map<Binding, number>();
  const locals: LocalSignalIdentity[] = [];
  let nextSignal = 0, nextRow = 0;
  const signalInitializers = new Map<number, BindingValue>();
  const activeFunctions = new Set<t.Node>(), activeValues = new Set<Binding>();

  function module(source: string, file: string, supplied?: t.File): Module {
    const cached = modules.get(file); if (cached) return cached;
    const ast = supplied ?? parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const references = new WeakMap<t.Node, Binding>(), scopes = new WeakMap<t.Node, Scope>(), functions = new Map<string, ComponentFunction>();
    let scope!: Scope;
    traverse(ast, {
      enter(path) {
        scopes.set(path.node, path.scope);
        if (path.isProgram()) scope = path.scope;
        if (isFunction(path.node)) functions.set(functionKey(path.node), path.node);
        if (t.isIdentifier(path.node) || t.isJSXIdentifier(path.node)) {
          const binding = path.scope.getBinding(path.node.name);
          if (binding) references.set(path.node, binding);
        }
      },
    });
    const result = { file, source, ast, scope, references, scopes, functions }; modules.set(file, result);
    traverse(ast, { Scopable(path) { for (const binding of Object.values(path.scope.bindings)) moduleOf.set(binding, result); } });
    return result;
  }
  function fromLookup(found: ResolvedExport): { module: Module; fn: ComponentFunction } {
    const mod = module(found.source, found.filePath, found.ast);
    return { module: mod, fn: mod.functions.get(functionKey(found.fn))! };
  }
  function immutable(binding: Binding, mod: Module, at: t.Node): void {
    if (binding.constantViolations.length) fail(mod, at, `binding ${binding.identifier.name} is reassigned; no stable native identity exists`);
  }
  function coreName(node: t.Node, mod: Module): string | undefined {
    if (!t.isIdentifier(node)) return undefined;
    const binding = mod.references.get(node);
    if (!binding) return node.name === 'h' || node.name === 'Fragment' ? node.name : undefined;
    const declaration = binding.path.node;
    if (!t.isImportSpecifier(declaration)) return undefined;
    const statement = binding.path.parentPath?.node;
    if (!t.isImportDeclaration(statement) || !['@getforma/core', 'formajs'].includes(statement.source.value) || statement.importKind === 'type' || declaration.importKind === 'type') return undefined;
    return name(declaration.imported);
  }
  function directSignal(binding: Binding, mod: Module): Signal | undefined {
    const declaration = binding.path.node;
    if (!t.isVariableDeclarator(declaration) || !t.isArrayPattern(declaration.id) || declaration.id.elements[0] !== binding.identifier || !declaration.init) return undefined;
    const call = unwrap(declaration.init);
    if (!t.isCallExpression(call) || coreName(call.callee, mod) !== 'createSignal' || call.arguments.length !== 1 || !t.isExpression(call.arguments[0])) return undefined;
    return { binding, module: mod, declaration, initial: call.arguments[0] };
  }
  function signal(binding: Binding, mod: Module, at: t.Node): Signal | undefined {
    const direct = directSignal(binding, mod); if (direct) return direct;
    const declaration = binding.path.node;
    if (!t.isImportSpecifier(declaration)) return undefined;
    const statement = binding.path.parentPath?.node;
    if (!t.isImportDeclaration(statement) || statement.importKind === 'type' || declaration.importKind === 'type') return undefined;
    const loaded = options.loadModule?.(mod.file, statement.source.value);
    if (!loaded) fail(mod, at, `unresolved captured binding ${binding.identifier.name} from ${statement.source.value}`);
    const found = resolveExportedSignal(loaded.source, loaded.path, name(declaration.imported)!, {
      loadModule: options.loadModule,
      readSignals(source, file) {
        const owner = module(source, file), result = new Map<string, Signal>();
        for (const [name, local] of Object.entries(owner.scope.bindings)) {
          const info = directSignal(local, owner); if (info) result.set(name, info);
        }
        return result;
      },
    });
    if (found.kind !== 'found') fail(mod, at, `unresolved capture: ${found.detail}`);
    return found.declarations.get(found.name)!;
  }
  function environment(mod: Module, parent?: Environment): Environment {
    return { module: mod, values: new Map(parent?.values), objects: new Map(parent?.objects), functions: new Set(parent?.functions), staticRows: new Set(parent?.staticRows) };
  }
  function binding(node: t.Node, env: Environment): Binding {
    const result = env.module.references.get(node);
    if (!result) fail(env.module, node, `unresolved native binding ${name(node) ?? node.type}`);
    immutable(result, env.module, node); return result;
  }
  function data(node: t.Node, env: Environment, depth = 0): unknown {
    if (depth > C.MAX_CONSTANT_DEPTH) fail(env.module, node, 'closed constant depth exceeds 1024');
    node = unwrap(node);
    if (t.isStringLiteral(node) || t.isBooleanLiteral(node)) return node.value;
    if (t.isTemplateLiteral(node) && node.expressions.length === 0) return node.quasis.map(part => part.value.cooked ?? part.value.raw).join('');
    if (t.isNullLiteral(node)) return null;
    if (t.isNumericLiteral(node)) {
      const raw = String(node.extra?.raw ?? node.value).replaceAll('_', '');
      // Decimal fractions/exponents are binary64 literals. Integer tokens must
      // retain their exact integer value before Babel/JS rounds it to f64.
      if (/^(?:[0-9]+|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)$/.test(raw)) {
        if (BigInt(raw) > BigInt(Number.MAX_SAFE_INTEGER)) fail(env.module, node, 'source integer literal exceeds the safe integer range');
      }
      if (!Number.isFinite(node.value)) fail(env.module, node, 'constant number must be finite');
      return Object.is(node.value, -0) ? 0 : node.value;
    }
    if (t.isIdentifier(node)) {
      const local = binding(node, env), declaration = local.path.node;
      if (activeValues.has(local)) fail(env.module, node, 'cyclic constant binding');
      if (t.isVariableDeclarator(declaration) && t.isIdentifier(declaration.id) && declaration.init) {
        activeValues.add(local);
        try { return data(declaration.init, environment(moduleOf.get(local) ?? env.module, env), depth + 1); }
        finally { activeValues.delete(local); }
      }
      if (t.isImportSpecifier(declaration)) {
        activeValues.add(local);
        try {
          const found = resolveImportedConstant(env.module.ast, env.module.file, node.name, {
            loadModule: options.loadModule,
            readConstants(source, file) {
              const owner = module(source, file), values = new Map<string, unknown[]>();
              for (const [name, entry] of Object.entries(owner.scope.bindings)) {
                const declaration = entry.path.node;
                if (t.isVariableDeclarator(declaration) && declaration.init && t.isArrayExpression(unwrap(declaration.init))) {
                  // Only the requested table is required to be closed; an
                  // unrelated runtime table cannot poison this module scan.
                  try { immutable(entry, owner, declaration); const value = data(declaration.init, environment(owner), depth + 1); if (Array.isArray(value)) values.set(name, value); } catch (error) { if (!(error instanceof PropsSchemaError)) throw error; }
                }
              }
              return values;
            },
          });
          if (found.kind === 'found') return found.value;
          fail(env.module, node, `unresolved closed table ${node.name}`);
        } finally { activeValues.delete(local); }
      }
      fail(env.module, node, `binding ${node.name} is not closed constant data`);
    }
    if (t.isArrayExpression(node)) {
      if (node.elements.length > C.MAX_CONSTANT_ARRAY_ELEMENTS) fail(env.module, node, 'closed array element limit');
      return node.elements.map(item => { if (!item || t.isSpreadElement(item)) fail(env.module, item ?? node, 'closed array needs dense explicit values'); return data(item, env, depth + 1); });
    }
    if (t.isObjectExpression(node)) {
      if (node.properties.length > C.MAX_SCHEMA_ITEMS) fail(env.module, node, 'closed object field limit');
      const result: Record<string, unknown> = Object.create(null);
      for (const field of node.properties) {
        if (!t.isObjectProperty(field) || field.computed) fail(env.module, field, 'closed object needs explicit data fields');
        const key = name(field.key); if (key === undefined || Object.hasOwn(result, key)) fail(env.module, field, 'closed object field must be named and unique');
        if(key==='__proto__')fail(env.module,field,'prototype-setting object literal fields are not closed own data');
        result[key] = data(field.value, env, depth + 1);
      }
      return result;
    }
    if (t.isUnaryExpression(node) && ['!', '+', '-'].includes(node.operator)) {
      const value = data(node.argument, env, depth + 1);
      if (node.operator === '!') return !value;
      if (typeof value !== 'number') fail(env.module, node, 'numeric constant unary operator needs a number');
      return node.operator === '-' ? -value : value;
    }
    fail(env.module, node, `unsupported closed native constant ${node.type}`);
  }
  function readCapture(info: Signal, at: t.Node, env: Environment): BindingValue {
    immutable(info.binding, info.module, info.declaration);
    if (env.functions.has(info.binding.scope.getFunctionParent()?.path.node as t.Node)) fail(env.module, at, 'local signal is used before its declaration or outside its block');
    let ordinal = captureIds.get(info.binding);
    if (ordinal === undefined) {
      const initial = data(info.initial, environment(info.module)); encodeClosedConstant(initial);
      ordinal = captures.length; captureIds.set(info.binding, ordinal); captureValues.push(initial);
      captures.push({ ordinal, getter: name(at) ?? info.binding.identifier.name, file: env.module.file, start: at.start ?? 0 });
    }
    return { kind: 'capture', id: ordinal, path: [] };
  }
  function project(parent: BindingValue, part: string, at: t.Node, env: Environment): BindingValue {
    if (parent.kind === 'prop' || parent.kind === 'signal' || parent.kind === 'row' || parent.kind === 'capture') return { ...parent, path: [...parent.path, part] };
    if (parent.kind === 'constant' && parent.value !== null && typeof parent.value === 'object' && Object.hasOwn(parent.value, part)) return { kind: 'constant', value: (parent.value as Record<string, unknown>)[part] };
    fail(env.module, at, 'native projection needs a declared path or a closed own field');
  }
  function objectFields(node: t.Identifier, env: Environment, visited = new Set<Binding>()): Map<string, DeferredValue> | undefined {
    const local = binding(node, env), known = env.objects.get(local);
    if (known) return known;
    if (visited.has(local)) fail(env.module, node, 'cyclic object alias binding');
    visited.add(local);
    const declaration = local.path.node;
    return t.isVariableDeclarator(declaration) && t.isIdentifier(declaration.init)
      ? objectFields(declaration.init, environment(moduleOf.get(local) ?? env.module, env), visited) : undefined;
  }
  function declared(value: BindingValue): boolean {
    switch (value.kind) {
      case 'prop': case 'row': return true;
      case 'signal': return declared(signalInitializers.get(value.id)!);
      case 'nullish': return declared(value.source);
      case 'unary': return declared(value.value);
      case 'binary': return declared(value.left) || declared(value.right);
      default: return false;
    }
  }
  function expression(node: t.Node, env: Environment, depth = 0): BindingValue {
    if (depth > C.MAX_VALUE_DEPTH) fail(env.module, node, 'binding expression depth exceeds 64');
    node = unwrap(node);
    if (isFunction(node)) {
      if (node.params.length) fail(env.module, node, 'binding getter takes no parameters');
      const returned = returnExpressionOf(node); if (!returned) fail(env.module, node, 'binding getter has no return value');
      return expression(returned, env, depth + 1);
    }
    if (scalar(node) || t.isArrayExpression(node) || t.isObjectExpression(node) || t.isTemplateLiteral(node) && node.expressions.length === 0) return { kind: 'constant', value: data(node, env) };
    if (t.isIdentifier(node)) {
      const local = binding(node, env), known = env.values.get(local);
      if (known) return resolved(known);
      const captured = signal(local, moduleOf.get(local) ?? env.module, node);
      if (captured) return readCapture(captured, node, env);
      const declaration = local.path.node;
      if (t.isVariableDeclarator(declaration) && t.isIdentifier(declaration.id) && declaration.init) {
        if (activeValues.has(local)) fail(env.module, node, 'cyclic alias binding');
        activeValues.add(local);
        try { return expression(declaration.init, environment(moduleOf.get(local) ?? env.module, env), depth + 1); }
        finally { activeValues.delete(local); }
      }
      fail(env.module, node, `unsupported native value ${node.name}`);
    }
    if (t.isOptionalMemberExpression(node)) {
      // A declared component props object is non-null. Normalize only its
      // direct optional read; nullable intermediates/calls keep their refusal.
      const key=!node.computed&&t.isIdentifier(node.property)?node.property.name:t.isStringLiteral(node.property)?node.property.value:undefined;
      if(node.optional&&key!==undefined&&t.isIdentifier(node.object)) {
        const object=objectFields(node.object,env),field=object?.get(key);
        if(field)return resolved(field);
      }
      fail(env.module,node,'optional access is admitted only on the proven non-null declared props object');
    }
    if (t.isMemberExpression(node)) {
      const key = !node.computed && t.isIdentifier(node.property) ? node.property.name : t.isStringLiteral(node.property) ? node.property.value : undefined;
      if (key === undefined) fail(env.module, node, 'native property path needs a literal field');
      if (t.isIdentifier(node.object)) {
        const object = objectFields(node.object, env);
        if (object) { const field = object.get(key); if (!field) fail(env.module, node, `field ${key} is absent from declared props`); return resolved(field); }
      }
      return project(expression(node.object, env, depth + 1), key, node, env);
    }
    if (t.isCallExpression(node) && node.arguments.length === 0) {
      const value = expression(node.callee, env, depth + 1);
      if ((value.kind === 'signal' || value.kind === 'capture') && value.path.length === 0) return value;
      fail(env.module, node, 'native getter call must resolve to an actual signal getter');
    }
    if (t.isLogicalExpression(node) && node.operator === '??') return { kind: 'nullish', source: expression(node.left, env, depth + 1), fallback: data(node.right, env) };
    if (t.isUnaryExpression(node) && ['!', '+', '-'].includes(node.operator)) {
      const value = expression(node.argument, env, depth + 1);
      if (declared(value)) fail(env.module, node, 'computed declared values remain outside the native subset');
      return { kind: 'unary', operator: node.operator as UnaryBindingOperator, value };
    }
    if ((t.isBinaryExpression(node) || t.isLogicalExpression(node)) && ['+', '-', '*', '/', '%', '**', '===', '!==', '<', '<=', '>', '>=', '&&', '||'].includes(node.operator)) {
      const left = expression(node.left, env, depth + 1), right = expression(node.right, env, depth + 1);
      if (declared(left) || declared(right)) fail(env.module, node, 'computed declared values remain outside the native subset');
      return { kind: 'binary', operator: node.operator as BinaryBindingOperator, left, right };
    }
    fail(env.module, node, `unsupported native binding expression ${node.type}`);
  }
  function bindParameter(param: t.Node | undefined, fields: Map<string, DeferredValue>, env: Environment): void {
    if (!param) return;
    if (t.isIdentifier(param)) { env.objects.set(binding(param, env), fields); return; }
    if (t.isObjectPattern(param)) {
      for (const field of param.properties) {
        if (!t.isObjectProperty(field) || field.computed || !t.isIdentifier(field.value)) fail(env.module, field, 'component props need explicit parameter aliases');
        const value = fields.get(name(field.key)!); if (!value) fail(env.module, field, 'destructured field is absent from declared props');
        env.values.set(binding(field.value, env), value);
      }
      return;
    }
    fail(env.module, param, 'unsupported component props parameter');
  }
  function callFields(arg: t.Node | undefined, env: Environment): Map<string, DeferredValue> {
    if (!arg || t.isNullLiteral(arg)) return new Map();
    if (t.isIdentifier(arg)) { const known = objectFields(arg, env); if (known) return new Map(known); }
    if (!t.isObjectExpression(arg)) fail(env.module, arg, 'component inputs need explicit declared fields');
    const fields = new Map<string, DeferredValue>();
    for (const field of arg.properties) {
      if (!t.isObjectProperty(field) || field.computed || name(field.key) === undefined) fail(env.module, field, 'component inputs need literal own fields');
      const key = name(field.key)!;
      if (fields.has(key)) fail(env.module, field, `duplicate component input ${key}`);
      // Helper inputs are only semantic bindings when the helper reads them.
      // CHILD resolves these thunks in its canonical declared-field order.
      fields.set(key, () => expression(field.value, env));
    }
    return fields;
  }
  function functionBody(fn: ComponentFunction, env: Environment, records: BindingRecord[]): void {
    if (activeFunctions.has(fn)) fail(env.module, fn, 'recursive component binding traversal');
    activeFunctions.add(fn); env.functions.add(fn);
    try {
      if (t.isBlockStatement(fn.body)) {
        for (const statement of fn.body.body) {
          if (t.isVariableDeclaration(statement)) {
            for (const declaration of statement.declarations) {
              if (!t.isArrayPattern(declaration.id) || !t.isIdentifier(declaration.id.elements[0])) {
                if (declaration.init) rejectInitializerWrites(declaration.init, env);
                continue;
              }
              const getter = declaration.id.elements[0], local = binding(getter, env), info = directSignal(local, env.module);
              if (!info) { if (declaration.init) rejectInitializerWrites(declaration.init, env); continue; }
              const ordinal = nextSignal++, initial = expression(info.initial, env);
              signalInitializers.set(ordinal, initial);
              records.push({ kind: 'signal', value: initial }); env.values.set(local, { kind: 'signal', id: ordinal, path: [] });
              const setter = declaration.id.elements[1];
              locals.push({ ordinal, getter: getter.name, setter: t.isIdentifier(setter) ? setter.name : undefined, file: env.module.file, start: declaration.start ?? 0, end: declaration.end ?? 0 });
            }
          } else if (t.isReturnStatement(statement)) { if (statement.argument) render(statement.argument, env, records); return; }
          else if (t.isExpressionStatement(statement)) {
            const value = unwrap(statement.expression);
            if (t.isStringLiteral(value)) continue;
            if (t.isCallExpression(value) && coreName(value.callee, env.module) === 'onCleanup') {
              // The callback runs at disposal, after initial rendering.
              for (const argument of value.arguments) rejectInitializerWrites(argument, env);
              continue;
            }
            if (t.isCallExpression(value) && coreName(value.callee, env.module) === 'createEffect') {
              const callback = value.arguments[0];
              if (value.arguments.length !== 1 || !isFunction(callback)) fail(env.module, value, 'pre-return effect needs a literal callback whose execution can be checked');
              rejectBindingWrites(callback.body, env); continue;
            }
            fail(env.module, statement, 'unsupported pre-return expression or mutation; native bindings must keep their described initial value');
          } else if (!t.isFunctionDeclaration(statement) && !t.isEmptyStatement(statement) && !t.isTSTypeAliasDeclaration(statement) && !t.isTSInterfaceDeclaration(statement)) fail(env.module, statement, 'unsupported native component control flow');
        }
      } else render(fn.body, env, records);
    } finally { activeFunctions.delete(fn); }
  }
  function rejectInitializerWrites(node: t.Node, env: Environment): void {
    // A function or identifier value is read without executing it. Every
    // other evaluated initializer must belong to the same closed expression
    // grammar as a native binding; that grammar never invokes accessors,
    // constructors, arbitrary helpers, optional calls, or nested effects.
    if (isFunction(node)) return;
    if (t.isIdentifier(node)) { binding(node, env); return; }
    const savedIds = new Map(captureIds), savedCount = captures.length;
    try { expression(node, env); }
    catch (error) {
      if (error instanceof PropsSchemaError) fail(env.module, node, `unsupported pre-return execution: ${error.message}`);
      throw error;
    } finally {
      // A harmless unused read must not acquire a canonical capture ordinal.
      captureIds.clear(); for (const [binding, id] of savedIds) captureIds.set(binding, id);
      captures.length = savedCount; captureValues.length = savedCount;
    }
  }
  function rejectBindingWrites(node: t.Node, env: Environment): void {
    if (t.isBlockStatement(node)) { for (const statement of node.body) rejectBindingWrites(statement, env); return; }
    if (t.isExpressionStatement(node)) { rejectInitializerWrites(node.expression, env); return; }
    if (t.isVariableDeclaration(node)) {
      for (const declaration of node.declarations) {
        if (!t.isIdentifier(declaration.id)) fail(env.module, declaration, 'pre-return effect locals need simple identifiers');
        if (declaration.init) rejectInitializerWrites(declaration.init, env);
      }
      return;
    }
    if (t.isReturnStatement(node)) { if (node.argument) rejectInitializerWrites(node.argument, env); return; }
    if (t.isEmptyStatement(node) || t.isFunctionDeclaration(node)) return;
    if (t.isIfStatement(node)) {
      rejectInitializerWrites(node.test, env); rejectBindingWrites(node.consequent, env);
      if (node.alternate) rejectBindingWrites(node.alternate, env); return;
    }
    if (t.isExpression(node)) { rejectInitializerWrites(node, env); return; }
    fail(env.module, node, 'unsupported pre-return effect statement; execution must be closed');
  }
  function registration(callee: t.Node, env: Environment): string | undefined {
    const localName = name(callee); if (!localName) return undefined;
    const local = env.module.references.get(callee);
    // A function-local namesake is never the module's registered component.
    if (local && !local.scope.path.isProgram()) return undefined;
    return options.registration ? options.registration(env.module.file, localName)
      : options.islands?.has(localName) ? localName : undefined;
  }
  function branch(node: t.Node | undefined, env: Environment): BindingRecord[] {
    const records: BindingRecord[] = []; if (!node) return records;
    node = unwrap(node);
    if (isFunction(node)) { if (node.params.length) fail(env.module, node, 'conditional branch must not take parameters'); functionBody(node, environment(env.module, env), records); }
    else render(node, env, records);
    return records;
  }
  function component(callee: t.Node, env: Environment, seen = new Set<Binding>()): { module: Module; fn: ComponentFunction } | undefined {
    const local = binding(callee, env), declaration = local.path.node;
    if (seen.has(local)) fail(env.module, callee, 'cyclic component alias'); seen.add(local);
    if (isFunction(declaration)) return { module: env.module, fn: declaration };
    if (t.isVariableDeclarator(declaration) && isFunction(declaration.init)) return { module: env.module, fn: declaration.init };
    if (t.isVariableDeclarator(declaration) && t.isIdentifier(declaration.init)) return component(declaration.init, env, seen);
    if (t.isImportSpecifier(declaration) || t.isImportDefaultSpecifier(declaration)) {
      const statement = local.path.parentPath!.node;
      if (t.isImportDeclaration(statement)) {
        const loaded = options.loadModule?.(env.module.file, statement.source.value);
        if (loaded) {
          const found = resolveExportedFunction(loaded.source, loaded.path, t.isImportDefaultSpecifier(declaration) ? 'default' : name(declaration.imported)!, { loadModule: options.loadModule });
          if (found.kind === 'found') return fromLookup(found);
        }
      }
    }
    return undefined;
  }
  function child(callee: t.Node, fields: Map<string, DeferredValue>, env: Environment, records: BindingRecord[]): void {
    const componentName = registration(callee, env);
    if (componentName) {
      const declared = options.childFields?.(componentName, env.module.file);
      if (!declared) fail(env.module, callee, `missing declared child schema for ${componentName}`);
      const canonical = [...declared].sort((a, b) => Buffer.compare(Buffer.from(a.name, 'utf8'), Buffer.from(b.name, 'utf8')));
      records.push({ kind: 'child', name: componentName, fields: canonical.map(field => {
        const value = fields.get(field.name);
        if (!value && !field.optional) fail(env.module, callee, `missing declared child input ${field.name}`);
        return { name: field.name, value: value ? resolved(value) : { kind: 'constant', value: null } };
      }) });
      return;
    }
    const found = component(callee, env);
    if (!found) fail(env.module, callee, 'cannot resolve native helper component');
    const nested = environment(found.module, env);
    bindParameter(found.fn.params[0], fields, nested); functionBody(found.fn, nested, records);
  }
  function attributes(properties: readonly (t.ObjectMember | t.SpreadElement)[], env: Environment, records: BindingRecord[]): void {
    for (const field of properties) {
      if (!t.isObjectProperty(field) || field.computed) fail(env.module, field, 'native attributes need literal named fields');
      const key = name(field.key); if (key === undefined) fail(env.module, field, 'native attribute name is unknown');
      if (/^on/i.test(key) || key === 'ref' || scalar(unwrap(field.value)) || staticRowRead(field.value, env)) continue;
      records.push({ kind: 'attribute', name: key, value: expression(field.value, env) });
    }
  }
  function staticRowRead(node: t.Node, env: Environment): boolean {
    node = unwrap(node);
    if (!t.isMemberExpression(node)) return false;
    let root: t.Node = node.object;
    while (t.isMemberExpression(root)) root = root.object;
    if (!t.isIdentifier(root)) return false;
    const local = env.module.references.get(root);
    if (!local || !env.staticRows.has(local)) return false;
    const value = expression(node, env);
    if (value.kind !== 'constant') fail(env.module, node, 'static map row did not resolve to closed data');
    return true;
  }
  function render(node: t.Node, env: Environment, records: BindingRecord[]): void {
    node = unwrap(node);
    if (scalar(node) || t.isJSXText(node)) { if (t.isNumericLiteral(node)) data(node, env); return; }
    if (staticRowRead(node, env)) return;
    if (t.isSpreadElement(node) && t.isCallExpression(node.argument) && t.isMemberExpression(node.argument.callee) && !node.argument.callee.computed && t.isIdentifier(node.argument.callee.property, { name: 'map' })) {
      const call = node.argument, callback = call.arguments[0];
      if (call.arguments.length !== 1 || !isFunction(callback) || callback.params.length !== 1 || !t.isIdentifier(callback.params[0])) fail(env.module, node, 'static map needs one explicit row callback');
      const rows = data(node.argument.callee.object, env); encodeClosedConstant(rows);
      if (!Array.isArray(rows)) fail(env.module, node, 'static map needs a closed array');
      for (const row of rows) {
        const nested = environment(env.module, env), parameter = binding(callback.params[0], nested);
        nested.values.set(parameter, { kind: 'constant', value: row }); nested.staticRows.add(parameter);
        functionBody(callback, nested, records);
      }
      return;
    }
    if (t.isJSXExpressionContainer(node)) { if (!t.isJSXEmptyExpression(node.expression)) render(node.expression, env, records); return; }
    if (isFunction(node)) { functionBody(node, environment(env.module, env), records); return; }
    if (t.isJSXFragment(node)) { for (const item of node.children) render(item, env, records); return; }
    if (t.isJSXElement(node)) {
      const opening = node.openingElement;
      if (!t.isJSXIdentifier(opening.name)) fail(env.module, opening, 'native component tag needs a lexical identifier');
      const fields: t.ObjectMember[] = [];
      for (const attribute of opening.attributes) {
        if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) fail(env.module, attribute, 'native attributes need explicit names');
        const value = attribute.value === null ? t.booleanLiteral(true) : t.isJSXExpressionContainer(attribute.value) ? attribute.value.expression : attribute.value;
        if (!t.isExpression(value)) fail(env.module, attribute, 'invalid attribute expression');
        fields.push(t.objectProperty(t.stringLiteral(attribute.name.name), value));
      }
      if (/^[a-z]/.test(opening.name.name)) { attributes(fields, env, records); for (const item of node.children) render(item, env, records); }
      else child(opening.name, callFields(t.objectExpression(fields), env), env, records);
      return;
    }
    if (t.isConditionalExpression(node)) { records.push({ kind: 'show', value: expression(node.test, env), then: branch(node.consequent, env), else: branch(node.alternate, env) }); return; }
    if (t.isCallExpression(node)) {
      const core = coreName(node.callee, env.module);
      if (core === 'h') {
        const tag = node.arguments[0], props = node.arguments[1];
        if (!tag) fail(env.module, node, 'h has no tag');
        if (t.isStringLiteral(tag)) {
          if (props && !t.isNullLiteral(props)) { if (!t.isObjectExpression(props)) fail(env.module, props, 'native h attributes need an object'); attributes(props.properties, env, records); }
          for (const item of node.arguments.slice(2)) render(item, env, records);
        } else child(tag, callFields(props, env), env, records);
        return;
      }
      if (core === 'Fragment') { for (const item of node.arguments) render(item, env, records); return; }
      if (core === 'createShow') {
        if (!node.arguments[0] || !node.arguments[1]) fail(env.module, node, 'createShow needs condition and branch');
        records.push({ kind: 'show', value: expression(node.arguments[0], env), then: branch(node.arguments[1], env), else: branch(node.arguments[2], env) }); return;
      }
      if (core === 'createList') {
        const [source, key, map] = node.arguments;
        if (!source || !key || !isFunction(key) || !isFunction(map) || !t.isIdentifier(key.params[0]) || !t.isIdentifier(map.params[0])) fail(env.module, node, 'createList needs named key and row callbacks');
        const ordinal = nextRow++, nested = environment(env.module, env), keyEnv = environment(env.module, env);
        nested.values.set(binding(map.params[0], nested), { kind: 'row', id: ordinal, path: [] });
        keyEnv.values.set(binding(key.params[0], keyEnv), { kind: 'row', id: ordinal, path: [] });
        const keyReturn = returnExpressionOf(key); if (!keyReturn) fail(env.module, key, 'list key has no return');
        const keyPath = expression(keyReturn, keyEnv); if (keyPath.kind !== 'row' || keyPath.id !== ordinal) fail(env.module, key, 'list key must be a literal row path');
        const value = expression(source, env), body: BindingRecord[] = []; functionBody(map, nested, body);
        records.push({ kind: 'list', value, key: keyPath.path, body }); return;
      }
      if (t.isIdentifier(node.callee)) {
        if (node.arguments.length === 0 && !registration(node.callee, env)) {
          const helper = component(node.callee, env);
          if (helper) { functionBody(helper.fn, environment(helper.module, env), records); return; }
          records.push({ kind: 'text', value: expression(node, env) }); return;
        }
        if (node.arguments.length <= 1) { child(node.callee, callFields(node.arguments[0], env), env, records); return; }
      }
    }
    records.push({ kind: 'text', value: expression(node, env) });
  }

  let root: {module:Module;fn:ComponentFunction};
  if (options.functionStart !== undefined) {
    const owner = module(source,file), fn = [...owner.functions.values()].find(fn=>fn.start===options.functionStart);
    if (!fn) throw new PropsSchemaError(file, 1, 1, 'registered function declaration is absent from original source');
    root = {module:owner,fn};
  } else {
    const found = resolveExportedFunction(source, file, exportedName, { loadModule: options.loadModule, allowLocal: true });
    if (found.kind !== 'found') throw new PropsSchemaError(file, 1, 1, found.detail);
    root = fromLookup(found);
  }
  const env = environment(root.module), records: BindingRecord[] = [];
  bindParameter(root.fn.params[0], new Map(options.props.map(name => [name, { kind: 'prop', path: [name] } as BindingValue])), env);
  functionBody(root.fn, env, records);
  const bindings: BindingRecord[] = [...captureValues.map(value => ({ kind: 'capture' as const, value })), ...records];
  encodeBindings('ssr', bindings);
  return { bindings, locals, captures };
}
