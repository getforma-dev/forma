/**
 * Value rules 6 and 7, the compiler's half (FORMA-182; docs/parity-rules.md;
 * decision brief DR-9, design 4's decision 2).
 *
 * Rule 6, BUILD-614: a text position whose value is boolean-typed is a build
 * error. `h()` writes nothing for a boolean child whatever its value, while
 * the walker writes `true` or `false` for a boolean slot, so a boolean bound
 * as text either breaks parity or shows nothing in the browser: the author
 * meant the word (`String(flag)`) or a conditional.
 *
 * Rule 7, BUILD-615: a `createShow` condition or a ternary test must be
 * boolean-typed. The walker picks the branch by ECMAScript ToBoolean, which a
 * number or a string only imitates (React's `{count && …}` printing `0`).
 *
 * Both refuse only what the compiler can prove from the source: a declared or
 * closed type, a signal's literal default, a module-level boolean `const`, or
 * the operator that produces the value. What it cannot type is left to the
 * existing paths (BUILD-301, BUILD-302).
 *
 * Verified by: packages/compiler/tests/value-rule-6-boolean-text.test.ts,
 * packages/compiler/tests/value-rule-7-conditions.test.ts and the BUILD-614 and
 * BUILD-615 pairs in packages/compiler/tests/diagnostics-conformance.test.ts.
 */
import * as t from '@babel/types';
import { parse } from '@babel/parser';
import { nestedScopeBindings } from './component-analyzer.js';
import { originalPosition } from './diagnostics';
import { PropsSchemaError } from './props-schema';
import { readSourceFile } from './source-snapshot';
import type { SignalDefault } from './signal-scope';

/**
 * Rule 6's attribute table (docs/parity-rules.md; findings F2 and F3): the
 * HTML boolean attributes, the ones a `true` writes bare. Every other
 * attribute is written as the value's string, `true` as "true". The same list
 * as core's BOOLEAN_ATTRS and the walker's HTML_BOOLEAN_ATTRIBUTES; all three
 * suites read it from crates/forma-ir/tests/fixtures/parity/attributes.json.
 * Verified by: packages/compiler/tests/value-rule-6-attributes.test.ts
 */
export const HTML_BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer', 'disabled',
  'formnovalidate', 'hidden', 'ismap', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate',
  'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);

/** What the compiler can prove about a value's type. */
export type ValueKind = 'boolean' | 'other' | 'unknown';

/** Names a classified expression can read. */
export interface KindEnvironment {
  /** The default of a scalar or aggregate signal in lexical scope. */
  signal(name: string): SignalDefault | undefined;
  /** A module-level constant's value (string or boolean); undefined when unknown. */
  constant(name: string): unknown;
}

const COMPARISON = new Set(['==', '!=', '===', '!==', '<', '<=', '>', '>=', 'instanceof', 'in']);

function combine(a: ValueKind, b: ValueKind): ValueKind {
  if (a === 'boolean' && b === 'boolean') return 'boolean';
  return a === 'other' || b === 'other' ? 'other' : 'unknown';
}

/**
 * The kind of value `node` produces. A getter (`() => …`) is read through.
 * `a && b`, `a || b`, `a ?? b` and `c ? a : b` are boolean only when both
 * results are: `ready() && 'Go'` is a string or `false`, so it is not.
 */
export function valueKind(node: t.Node | null | undefined, env: KindEnvironment): ValueKind {
  if (!node) return 'unknown';
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node)
    || t.isTSTypeAssertion(node) || t.isParenthesizedExpression(node)) return valueKind(node.expression, env);
  if ((t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) && node.params.length === 0) {
    const body = t.isBlockStatement(node.body)
      ? node.body.body.length === 1 && t.isReturnStatement(node.body.body[0]) ? node.body.body[0].argument : undefined
      : node.body;
    return valueKind(body, env);
  }
  if (t.isBooleanLiteral(node)) return 'boolean';
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBigIntLiteral(node) || t.isNullLiteral(node)
    || t.isTemplateLiteral(node)) return 'other';
  if (t.isUnaryExpression(node)) return node.operator === '!' || node.operator === 'delete' ? 'boolean' : 'other';
  if (t.isBinaryExpression(node)) return COMPARISON.has(node.operator) ? 'boolean' : 'other';
  if (t.isLogicalExpression(node)) return combine(valueKind(node.left, env), valueKind(node.right, env));
  if (t.isConditionalExpression(node)) return combine(valueKind(node.consequent, env), valueKind(node.alternate, env));
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    if (node.arguments.length === 0) {
      const signal = env.signal(node.callee.name);
      if (signal) return signal.type === 'bool' ? 'boolean' : 'other';
    } else if (node.arguments.length === 1 && !t.isSpreadElement(node.arguments[0])) {
      if (node.callee.name === 'Boolean') return 'boolean';
      if (node.callee.name === 'String' || node.callee.name === 'Number') return 'other';
    }
  }
  if (t.isIdentifier(node)) {
    if (node.name === 'undefined') return 'other';
    const value = env.constant(node.name);
    if (value !== undefined) return typeof value === 'boolean' ? 'boolean' : 'other';
  }
  return 'unknown';
}

/** Whether closed values (an aggregate field, a LIST row field) are boolean-typed: booleans, absent allowed, at least one. */
export function closedKind(values: readonly unknown[]): ValueKind {
  if (values.some(value => value !== null && typeof value !== 'boolean')) return 'other';
  return values.some(value => typeof value === 'boolean') ? 'boolean' : 'other';
}

type Literal = boolean | number | string;
const moduleLiterals = new Map<string, { source: string; values: Map<string, Literal> }>();

/**
 * A module-level `const NAME = <boolean, number or string literal>` of `file`
 * (export-wrapped or not, through `as const`), unless the name is also bound in
 * a nested scope (the same conservative shadowing guard the string constants
 * use). Rules 6 and 7 read its type; only a condition folds its value.
 */
export function moduleLiteral(file: string | undefined, name: string): Literal | undefined {
  if (!file) return undefined;
  let source: string;
  try { source = readSourceFile(file); } catch { return undefined; }
  let entry = moduleLiterals.get(file);
  if (!entry || entry.source !== source) {
    const values = new Map<string, Literal>();
    try {
      const ast = parse(source, { sourceType: 'module', plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? ['jsx' as const] : [])] });
      for (const statement of ast.program.body) {
        const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
        if (!t.isVariableDeclaration(declaration) || declaration.kind !== 'const') continue;
        for (const declarator of declaration.declarations) {
          let init: t.Node | null | undefined = declarator.init;
          while (init && (t.isTSAsExpression(init) || t.isTSSatisfiesExpression(init) || t.isParenthesizedExpression(init))) init = init.expression;
          if (t.isIdentifier(declarator.id) && (t.isBooleanLiteral(init) || t.isNumericLiteral(init) || t.isStringLiteral(init))) values.set(declarator.id.name, init.value);
        }
      }
      for (const shadowed of nestedScopeBindings(ast)) values.delete(shadowed);
    } catch { /* an unparseable module proves nothing */ }
    entry = { source, values };
    moduleLiterals.set(file, entry);
  }
  return entry.values.get(name);
}

function refuse(code: 'BUILD-614' | 'BUILD-615', file: string, node: t.Node, detail: string): never {
  const at = originalPosition(file, node.loc?.start ?? { line: 1, column: 0 });
  throw new PropsSchemaError(file, at.line, at.column, detail, code);
}

/**
 * How a BUILD-614 message tells the author to write the word, so the advice
 * builds: `String(…)` where the compiler binds or folds it (a non-optional
 * declared boolean, a signal, an expression it evaluates); a ternary where
 * `String(…)` is itself refused (an optional declared boolean, whose absent
 * value would print "undefined"; a closed value or a module const, which the
 * compiler does not fold through `String()`).
 */
export type WordFix = 'string' | 'ternary';

/** Rule 6: `what` reads a boolean into a text position. */
export function refuseBooleanText(file: string, node: t.Node, what: string, fix: WordFix = 'string'): never {
  const word = fix === 'string'
    ? 'write String(…) of it for the word'
    : "write the word with a ternary, `() => (flag ? 'yes' : 'no')` (String() of it does not build here)";
  refuse('BUILD-614', file, node,
    `${what} is a boolean in text: the browser writes nothing for it whatever its value, and the server would write "true" or "false"; ${word}, or use createShow for content`);
}

/** Rule 7: `what` is a condition that is not boolean-typed. */
export function refuseConditionType(file: string, node: t.Node, what: string): never {
  refuse('BUILD-615', file, node,
    `${what} is not boolean-typed: the server would pick the branch by truthiness, which the page only imitates; compare explicitly (count() > 0, name() !== '', item() !== null)`);
}

/** Rule 7: a condition names the signal getter `name` without calling it. A
 *  function is always truthy, so the browser always takes the first branch
 *  whatever the signal holds. */
export function refuseUncalledGetter(file: string, node: t.Node, name: string): never {
  refuse('BUILD-615', file, node,
    `condition reads the signal getter ${name} without calling it: a function is always truthy, so the browser always takes the first branch; call it, ${name}()`);
}
