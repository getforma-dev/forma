/**
 * FORMA-271: an allowlisted native that throws on its arguments.
 *
 * `JSON.parse('{')` throws a SyntaxError, `(1).toFixed(500)` a RangeError,
 * `Object.keys(null)` and `[].reduce(f)` a TypeError, and a selector the DOM
 * cannot parse a DOMException. The interpreter called each native bare, so the
 * exception was not an expression error, the runtime's binding boundary
 * rethrew it, and it escaped `mountMarkup` from any binding: one bad payload
 * in a `data-text` cost the whole module (found by FORMA-268's review).
 *
 * Now the call is wrapped where the interpreter makes it, and only there: an
 * exception the native throws is a coded `FORMA_E_CALL_FAILED` that names the
 * method and the error. What Forma's own code throws while a native runs it
 * (an arrow callback, a handler a `click()` dispatches, a runtime magic such as
 * `$dispatch`) passes through as it is, whether it is an expression error with
 * its own code and `defer`, or a real bug.
 */
import { describe, expect, it } from 'vitest';
import { compileExpression, evaluateExpression, isExprError, type FormaExprError, type Meter, type ScopeLike } from '../index';
import { hostFn, hostNamespace, hostObject } from '../host';
import { scopeOf } from './helpers';
import { callables } from './hostile-natives';

/** 10,000 arrays, each the only element of the one before: within every budget, past V8's stack for `join` (refused before any native sees it since FORMA-274). */
const deep: unknown = JSON.parse('['.repeat(10_000) + ']'.repeat(10_000));

const STATE = { items: [3, 1, 2], empty: [], s: 'abc', n: 1.5, nothing: null, bad: '{"a":', deep };

function attempt(src: string, state: Record<string, unknown> = STATE, meter?: Meter, scope: ScopeLike = scopeOf(state)): { value?: unknown; error?: unknown } {
  try {
    return { value: evaluateExpression(compileExpression(src), scope, meter) };
  } catch (error) {
    return { error };
  }
}

function failure(src: string, state: Record<string, unknown> = STATE, meter?: Meter, scope?: ScopeLike): FormaExprError {
  const { error } = attempt(src, state, meter, scope);
  expect(isExprError(error), `${src} must be refused with a coded error, got ${String(error)}`).toBe(true);
  return error as FormaExprError;
}

/** Each throw found in the allowlist: the expression, the method the message names, the native's error. */
const THROWS: [src: string, method: string, error: string][] = [
  [`JSON.parse('{')`, 'JSON.parse', 'SyntaxError'],
  ['JSON.parse(bad)', 'JSON.parse', 'SyntaxError'],
  [`JSON.parse('')`, 'JSON.parse', 'SyntaxError'],
  ['n.toFixed(500)', 'number.toFixed', 'RangeError'],
  ['(1).toFixed(-1)', 'number.toFixed', 'RangeError'],
  ['n.toPrecision(0)', 'number.toPrecision', 'RangeError'],
  ['n.toPrecision(101)', 'number.toPrecision', 'RangeError'],
  ['(1).toString(1)', 'number.toString', 'RangeError'],
  ['(255).toString(37)', 'number.toString', 'RangeError'],
  ['Object.keys(nothing)', 'Object.keys', 'TypeError'],
  ['Object.values(nothing)', 'Object.values', 'TypeError'],
  ['Object.entries(nothing)', 'Object.entries', 'TypeError'],
  ['Array.from(nothing)', 'Array.from', 'TypeError'],
  ['empty.reduce((a, x) => a + x)', 'array.reduce', 'TypeError'],
  ...['every', 'filter', 'find', 'findIndex', 'flatMap', 'map', 'reduce', 'some'].map(
    (m): [string, string, string] => [`items.${m}()`, `array.${m}`, 'TypeError'],
  ),
];

describe('an allowlisted native that throws is a coded failure (FORMA-271)', () => {
  it.each(THROWS)('%s is refused with FORMA_E_CALL_FAILED naming %s and its %s', (src, method, name) => {
    const err = failure(src);
    expect(err.code).toBe('FORMA_E_CALL_FAILED');
    expect(err.message.startsWith(`${method}() threw ${name}: `), err.message).toBe(true);
    expect(err.column, 'positioned at the call').toBeGreaterThanOrEqual(0);
    expect(err.defer, 'final: retrying it in a later task would throw again').toBeUndefined();
  });

  it('no allowlisted native throws a raw exception, whatever plain data it is given, and these are the ones that refuse', () => {
    // Every callable the allowlist grants, each given every argument below
    // (and its usual receiver): each call answers a value or a coded error.
    // The set of natives found to throw is pinned, so a native added to the
    // allowlist that can throw shows up here.
    const ARGS = ['nothing', '500', '-1', '0', '1', '37', '101', `'{'`, `''`, 'bad', '{a: 1}', '[1, [2]]', 's', 'items'];
    const raw: string[] = [];
    const failed = new Set<string>();
    for (const c of callables()) {
      for (const arg of ARGS) {
        const src = c.call(arg);
        const { error } = attempt(src);
        if (error === undefined) continue;
        if (!isExprError(error)) raw.push(`${src}: ${String(error)}`);
        else if (error.code === 'FORMA_E_CALL_FAILED') failed.add(c.name);
      }
    }
    expect(raw).toEqual([]);
    expect([...failed].sort()).toEqual([
      'Array.from', 'JSON.parse', 'Object.entries', 'Object.keys', 'Object.values',
      'number.toFixed', 'number.toPrecision', 'number.toString',
    ]);
  });

  it('the message names the method and the error, and is bounded', () => {
    // A DOM method's message can quote its argument (a selector) whole.
    const long = 'x'.repeat(10_000);
    const el = { focus: () => { throw new RangeError(long); } };
    const scope = scopeOf({});
    scope.getters.$el = () => hostObject('element', el, '$el');
    let err: unknown;
    try { evaluateExpression(compileExpression('$el.focus()'), scope); } catch (e) { err = e; }
    expect(isExprError(err)).toBe(true);
    const { code, message } = err as FormaExprError;
    expect(code).toBe('FORMA_E_CALL_FAILED');
    expect(message.startsWith('$el.focus() threw RangeError: xxx')).toBe(true);
    expect(message.length).toBeLessThanOrEqual(240);
  });

  it('code an application put in reach and a native runs is converted: a toString of a value in state, an override of an element method', () => {
    // The native call is what threw, so it is reported on the binding, named.
    const scope = scopeOf({ v: { toString: () => { throw new TypeError('app toString'); } } });
    scope.getters.$el = () => hostObject('element', { blur: () => { throw new Error('app blur'); } }, '$el');
    // An intrinsic in a callback slot: the call the callback makes is wrapped too.
    const errs = ['String(v)', '[v].map(String)', '$el.blur()'].map((src) => {
      try { evaluateExpression(compileExpression(src), scope); } catch (e) { return e as FormaExprError; }
      return null;
    });
    expect(errs.map((e) => [e?.code, e?.message])).toEqual([
      ['FORMA_E_CALL_FAILED', 'String() threw TypeError: app toString'],
      ['FORMA_E_CALL_FAILED', 'String() threw TypeError: app toString'],
      ['FORMA_E_CALL_FAILED', '$el.blur() threw Error: app blur'],
    ]);
  });

  it('a DOM method that throws on its arguments is a coded failure', () => {
    const el = document.createElement('p');
    const scope = scopeOf({});
    scope.getters.$el = () => hostObject('element', el, '$el');
    for (const [src, method] of [[`$el.matches('#1')`, '$el.matches'], [`$el.querySelector('.')`, '$el.querySelector']] as const) {
      let err: unknown;
      try { evaluateExpression(compileExpression(src), scope); } catch (e) { err = e; }
      expect(isExprError(err), `${src}: ${String(err)}`).toBe(true);
      expect((err as FormaExprError).code).toBe('FORMA_E_CALL_FAILED');
      expect((err as FormaExprError).message.startsWith(`${method}() threw `)).toBe(true);
    }
  });
});

describe("what Forma's own code throws while a native runs it is not the native's failure (FORMA-271)", () => {
  const bug = new RangeError('a real bug');
  const buggy = (): Record<string, unknown> => ({ ...STATE });

  it('a real bug in an arrow callback passes through as it is', () => {
    const scope = scopeOf(buggy());
    scope.getters.boom = () => { throw bug; };
    let err: unknown;
    try { evaluateExpression(compileExpression('items.map(x => boom)'), scope); } catch (e) { err = e; }
    expect(err).toBe(bug);
  });

  it('a runtime magic is Forma code, not a native: what it throws passes through as it is', () => {
    // `$dispatch` and `$refetch` are `fn` hosts the runtime makes; only the
    // captured intrinsics (`Number`, `String`, `parseInt`, ...) are natives.
    for (const src of [`$dispatch('go')`, 'items.map($dispatch)']) {
      const scope = scopeOf(buggy());
      scope.getters.$dispatch = () => hostFn('$dispatch', () => { throw bug; }, 2);
      let err: unknown;
      try { evaluateExpression(compileExpression(src), scope); } catch (e) { err = e; }
      expect(err, src).toBe(bug);
    }
  });

  it('a real bug in an evaluation a DOM method runs (a handler a click() dispatches) passes through as it is', () => {
    // An engine that hands a listener's exception back to `click()` (happy-dom
    // does; browsers report it instead) must not have it filed as the click's.
    const inner = scopeOf(buggy());
    inner.getters.boom = () => { throw bug; };
    const handler = compileExpression('boom');
    const el = { click: () => { evaluateExpression(handler, inner); } };
    const scope = scopeOf({});
    scope.getters.$el = () => hostObject('element', el, '$el');
    let err: unknown;
    try { evaluateExpression(compileExpression('$el.click()'), scope); } catch (e) { err = e; }
    expect(err).toBe(bug);
  });

  it('an expression error inside a callback keeps its own code', () => {
    expect(failure('items.map(x => x.constructor)').code).toBe('FORMA_E_KEY_DENIED');
    expect(failure('[nothing].map(x => Object.keys(x))').code).toBe('FORMA_E_CALL_FAILED');
  });

  it("a budget refusal inside a callback keeps its defer, so it still waits for a later task", () => {
    // The task had spent units before this evaluation, so a charge that does
    // not fit the room left is retried in the next task (FORMA-028).
    const meter: Meter = { steps: 0, cost: 200_000 };
    const err = failure('[1].map(x => Array.from({length: 60000}).length)', STATE, meter);
    expect(err.code).toBe('FORMA_E_BUDGET');
    expect(err.defer).toBe(true);
  });
});

describe('a native that throws spends what it was charged, and arms nothing (FORMA-271, DR-16)', () => {
  it("its charges before it ran stay on the task's meter, as any evaluation's do", () => {
    // JSON.parse is charged the text weight of its argument before it runs.
    const big = '{' + 'x'.repeat(99_999);
    const meter: Meter = { steps: 0, cost: 0 };
    const err = failure('JSON.parse(big)', { big }, meter);
    expect(err.code).toBe('FORMA_E_CALL_FAILED');
    expect(err.defer).toBeUndefined();
    expect(meter.cost).toBe(100_000);
    expect(meter.cap, 'the interpreter arms no cap').toBeUndefined();
  });
});

describe('the paths FORMA-271 left (FORMA-274)', () => {
  it.each([
    ['deep.join()'],
    ['[deep, deep].sort()'],
    ['JSON.stringify(deep)'],
    ['String(deep)'],
    ['[deep].map(String)'],
    ["'' + deep"],
    ['[1, 2].sort((a, b) => deep)'],
    ['Array.from({length: 10000}).reduce(a => [a], 0) + 1'],
  ])('%s: a value nested over 100 deep with FORMA_E_BUDGET before anything converts it', (src) => {
    const err = failure(src);
    expect([err.code, err.message]).toEqual(['FORMA_E_BUDGET', 'a value nested over 100 deep']);
    expect(err.defer, 'final, like a refusal that checks a length: it arms nothing').toBeUndefined();
  });

  it('a value 100 deep is converted; one 101 deep is refused', () => {
    let v: unknown = 0;
    for (let i = 0; i < 100; i++) v = [v];
    expect(attempt("'' + v", { v })).toEqual({ value: '0' });
    expect(failure("'' + v", { v: [v] }).code).toBe('FORMA_E_BUDGET');
  });

  it('what a native throws that cannot be converted to text is still reported, named as unprintable', () => {
    const scope = scopeOf({});
    for (const thrown of [Object.create(null), { toString() { throw new Error('inner'); } }]) {
      scope.getters.$el = () => hostObject('element', { blur: () => { throw thrown; } }, '$el');
      const err = failure('$el.blur()', {}, undefined, scope);
      expect([err.code, err.message]).toEqual(['FORMA_E_CALL_FAILED', '$el.blur() threw an unprintable value']);
    }
  });

  it("a namespace member is a native only if the namespace is the allowlist's own: a runtime magic's member passes what it throws through", () => {
    const bug = new RangeError('a real bug');
    const scope = scopeOf({});
    scope.getters.magic = () => hostNamespace('magic', { boom: () => { throw bug; } });
    let err: unknown;
    try { evaluateExpression(compileExpression('magic.boom()'), scope); } catch (e) { err = e; }
    expect(err).toBe(bug);
    expect(failure(`JSON.parse('{')`).code).toBe('FORMA_E_CALL_FAILED');
    expect(failure('Number.parseInt(1, 1).toFixed(500)').code).toBe('FORMA_E_CALL_FAILED');
  });

  it('a DOM method that answers a promise has its rejection reported to the scope, never left unhandled', async () => {
    const reported: Array<[string, string, string]> = [];
    const scope = scopeOf({});
    scope.fail = (what, err) => { reported.push([what, err.code, err.message]); };
    scope.getters.$el = () => hostObject('element', {
      scrollIntoView: () => Promise.reject(new TypeError('bad behavior')),
      focus: () => Promise.resolve(1),
    }, '$el');
    evaluateExpression(compileExpression('$el.scrollIntoView()'), scope);
    evaluateExpression(compileExpression('$el.focus()'), scope);
    await new Promise((r) => setTimeout(r, 0));
    expect(reported).toEqual([['$el.scrollIntoView', 'FORMA_E_CALL_FAILED', '$el.scrollIntoView() rejected TypeError: bad behavior']]);
  });

  it("happy-dom's click() hands a listener's exception back to its caller, where a browser reports it: the step rule keeps Forma's own as Forma's", () => {
    // Pinned so a change in happy-dom is noticed. In a browser a listener's
    // exception never reaches click(); here it does, so a unit test that
    // dispatches through $el.click() sees a listener bug come back through the
    // native call. A Forma listener steps before it can throw (the handler's
    // first statement steps), so its error passes through as it is; only an
    // exception thrown before that first step (outside any evaluation) would be
    // filed as the click's, in unit tests alone. e2e/native-throw.spec.ts
    // checks the browser's side.
    const button = document.createElement('button');
    const listenerBug = new RangeError('listener bug');
    button.addEventListener('click', () => { throw listenerBug; });
    let thrown: unknown;
    try { button.click(); } catch (e) { thrown = e; }
    expect(thrown).toBe(listenerBug);
  });
});
