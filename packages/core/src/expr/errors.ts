/**
 * Errors raised by the allowlist expression engine.
 *
 * Every failure mode has a stable code, because the whole point of this engine
 * is that an expression it cannot evaluate says so. `undefined` is a legitimate
 * VALUE here (an absent object key, a nullish base), so it can never double as
 * an error signal — see R1 in docs/design/CSP-GRAMMAR.md.
 *
 * These are plain branded `Error` objects rather than a class hierarchy: a
 * `class` body would put the identifier `constructor` into src/expr/, which the
 * escape-hatch gate rejects on sight so that the *real* thing it is looking for
 * (`x.constructor`) cannot hide behind a false positive.
 * Verified by: src/expr/__tests__/no-escape-hatch.test.ts > "src/expr contains no path to the Function constructor or a global"
 */

export type ExprErrorCode =
  /** The lexer or parser refused the source text. */
  | 'FORMA_E_SYNTAX'
  /** Syntactically fine, semantically outside the grammar (e.g. a stray arrow). */
  | 'FORMA_E_UNSUPPORTED'
  /** A parse-time budget (length, node count, depth, arity) was exceeded. */
  | 'FORMA_E_LIMIT'
  /** An identifier resolved to nothing — never a global, never `undefined`. */
  | 'FORMA_E_UNRESOLVED'
  /** A property key was rejected by `safeKey` (deny-listed, symbol, oversized). */
  | 'FORMA_E_KEY_DENIED'
  /** A property read was refused for this receiver kind. */
  | 'FORMA_E_PROPERTY_DENIED'
  /** No allowlisted method of that name exists for this receiver kind. */
  | 'FORMA_E_METHOD_DENIED'
  /** The call target is not an allowlisted callable. */
  | 'FORMA_E_CALL_DENIED'
  /**
   * An allowlisted call was made and its native threw on its arguments
   * (`JSON.parse('{')`, `(1).toFixed(500)`, `Object.keys(null)`, a selector
   * the DOM cannot parse). The message names the method and the error
   * (FORMA-271). Final, like the refusals that check a length: `defer` unset.
   * Since FORMA-274 also: a DOM write the browser refused, the runtime's own
   * (`data-model write threw …`) or a handler's (`$el.value = … threw …`); a
   * DOM method's promise that rejected (`… rejected …`, reported after the
   * evaluation); and a value whose `toString` is not a function, refused
   * before it is converted to text or a number.
   */
  | 'FORMA_E_CALL_FAILED'
  /** The assignment target is unknown or not writable. */
  | 'FORMA_E_ASSIGN_DENIED'
  /**
   * An evaluation-time budget (steps, array/string size) was exceeded, or
   * (FORMA-274) a value nested more than 100 deep was to be converted, or a
   * 33rd evaluation would have nested inside the others.
   */
  | 'FORMA_E_BUDGET'
  /**
   * Under a tiered mount (FORMA-128), an element host would have reached past
   * the mount root, or read the page outside it through a selector, and the
   * mount grants no `dom`.
   */
  | 'FORMA_E_GRANT_DOM'
  /** Under a tiered mount, `click()` (which can follow a link or submit a form) without `navigate`. */
  | 'FORMA_E_GRANT_NAVIGATE';

const EXPR_ERROR = Symbol.for('forma.expr.error');

export interface FormaExprError extends Error {
  code: ExprErrorCode;
  /** 0-based column in the expression source, or -1 when not positional. */
  column: number;
  /**
   * Set only on a `FORMA_E_BUDGET` refusal the budget meter makes (an
   * allocation charge or the step count). True when the evaluation began with
   * part of its task's budget already spent (FORMA-028): run first in a later
   * task it may fit, so the runtime retries it there instead of reporting it.
   * False when it is final, and reported. Left unset by the refusals that
   * check a length or a count (`repeat()` past its cap, `flat()` too deep, a
   * string past 1 MiB, an index past the budget), and by every other code,
   * `FORMA_E_CALL_FAILED` included: the runtime reports those
   * as final and arms nothing for them (FORMA-249). What the evaluation
   * charged before the check (for `repeat()` and `flat()`, their cost-table
   * row) stays on the meter, and a charge before the check that does not fit
   * is refused by the meter first, with `defer` set: false when final, so the
   * runtime arms the cap for it (FORMA-250).
   */
  defer?: boolean;
}

/** Build a reportable expression error. */
export function exprError(
  code: ExprErrorCode,
  message: string,
  column = -1,
): FormaExprError {
  const err = new Error(message) as FormaExprError;
  err.name = 'FormaExpressionError';
  err.code = code;
  err.column = column;
  (err as unknown as Record<symbol, unknown>)[EXPR_ERROR] = true;
  return err;
}

/**
 * True for errors this engine raised deliberately. The binding boundary in
 * runtime.ts reports these and leaves the DOM untouched; anything else is a bug
 * in FormaJS and is rethrown rather than swallowed.
 * Verified by: src/__tests__/failure-semantics.test.ts > "a genuine runtime bug is not swallowed as an expression denial"
 */
export function isExprError(e: unknown): e is FormaExprError {
  return (
    typeof e === 'object'
    && e !== null
    && (e as Record<symbol, unknown>)[EXPR_ERROR] === true
  );
}
