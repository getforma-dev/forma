import { deepStrictEqual, strictEqual } from 'node:assert';
type Engine = typeof import('../../index');

/** Capture a bounded native witness in a fresh engine. Both calls ask for four
 * slots, so even a broken budget check cannot allocate hostile quantities. */
export async function runPreflight(load: () => Promise<Engine>): Promise<{ admittedNativeCalls: number; refusedNativeCalls: number; code: string }> {
  const shape = { length: 4 };
  const original = Array.from;
  let calls = 0;
  Array.from = new Proxy(original, {
    apply(target, self, args) {
      if (args[0] === shape) calls++;
      return Reflect.apply(target, self, args);
    },
  });
  let engine: Engine;
  try { engine = await load(); } finally { Array.from = original; }
  const ast = engine.compileExpression('Array.from(shape)');
  const scope = { getters: { shape: () => shape }, setters: {} };
  deepStrictEqual(engine.evaluateExpression(ast, scope, { steps: 0, cost: 249_986 }), Array(4).fill(undefined));
  strictEqual(calls, 1, 'admitted call must reach the captured native witness');
  let code = '';
  const meter = { steps: 0, cost: 249_990 };
  try { engine.evaluateExpression(ast, scope, meter); } catch (error) {
    if (!engine.isExprError(error)) throw error;
    code = error.code;
  }
  strictEqual(code, 'FORMA_E_BUDGET');
  strictEqual(calls, 1, 'over-budget call must stop before the bounded native');
  strictEqual(meter.cost, 249_990, 'rejected charge must not consume budget');
  return { admittedNativeCalls: 1, refusedNativeCalls: 0, code };
}
