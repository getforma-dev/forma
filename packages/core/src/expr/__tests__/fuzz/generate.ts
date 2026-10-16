import { COST_OPERATIONS, costCase, type CostCase } from './cost-cases';

export type GeneratedCase = CostCase | {
  operation: string;
  source: string;
  state: Record<string, unknown>;
  expected: unknown;
  minimumCost: number;
  handler?: true;
  expectedState?: Record<string, unknown>;
  refused?: string;
};

/** Mulberry32: the recorded seed and index completely determine the input. */
export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 0x1_0000_0000;
  };
}

interface Model { source: string; value: number }
/** Carry a semantic value while constructing syntax; never eval its source. */
function numeric(random: () => number, x: number, depth: number): Model {
  if (depth === 0) {
    if (random() < .5) return { source: 'x', value: x };
    const value = Math.floor(random() * 201) - 100;
    return { source: String(value), value };
  }
  const a = numeric(random, x, depth - 1);
  const b = numeric(random, x, depth - 1);
  switch (Math.floor(random() * 6)) {
    case 0: return { source: `(${a.source} + ${b.source})`, value: a.value + b.value };
    case 1: return { source: `(${a.source} - ${b.source})`, value: a.value - b.value };
    case 2: return { source: `(${a.source} * ${b.source})`, value: a.value * b.value };
    case 3: return { source: `(-(${a.source}))`, value: -a.value };
    case 4: return { source: `(${a.source} > ${b.source} ? ${a.source} : ${b.source})`, value: a.value > b.value ? a.value : b.value };
    default: return { source: `(${a.source} || ${b.source})`, value: a.value || b.value };
  }
}

const GRAMMAR_FAMILIES = 13;
const REFUSALS = [
  ['items.constructor', 'FORMA_E_KEY_DENIED'],
  ["items['cons' + 'tructor']", 'FORMA_E_KEY_DENIED'],
  ['window', 'FORMA_E_UNRESOLVED'],
  ['globalThis', 'FORMA_E_UNRESOLVED'],
  ["items.map(x => x).constructor", 'FORMA_E_KEY_DENIED'],
  ["({}).constructor.constructor('return 1')()", 'FORMA_E_KEY_DENIED'],
  ['x +', 'FORMA_E_SYNTAX'],
] as const;

export const MANDATORY_CASE_COUNT = COST_OPERATIONS.length + GRAMMAR_FAMILIES + REFUSALS.length;

/** Cost rows, grammar and refusals all have mandatory scheduled coverage. */
export function generateCase(random: () => number, index: number): GeneratedCase {
  const family = index % MANDATORY_CASE_COUNT;
  if (family < COST_OPERATIONS.length) return costCase(COST_OPERATIONS[family]!, 1 + Math.floor(random() * 64));
  const x = Math.floor(random() * 2001) - 1000;
  const n = numeric(random, x, 2 + Math.floor(random() * 2));
  const make = (operation: string, source: string, state: Record<string, unknown>, expected: unknown): GeneratedCase =>
    ({ operation, source, state, expected, minimumCost: 0 });
  switch (family - COST_OPERATIONS.length) {
    case 0: return make('grammar/numeric', n.source, { x }, n.value);
    case 1: return make('grammar/template', '`value=${x}`', { x }, `value=${x}`);
    case 2: return make('grammar/array-member', '[x, x + 1].length', { x }, 2);
    case 3: return make('grammar/object-member', '({value: x}).value', { x }, x);
    case 4: return make('grammar/computed', "obj[key]", { obj: { value: x }, key: 'value' }, x);
    case 5: return make('grammar/optional', 'obj?.value ?? x', { obj: null, x }, x);
    case 6: return make('grammar/logical', 'x >= 0 && x < 100', { x }, x >= 0 && x < 100);
    case 7: return make('grammar/callback', 'items.map(v => v + x)', { items: [1, 2, 3], x }, [1 + x, 2 + x, 3 + x]);
    case 8: return make('grammar/conditional', 'x < 0 ? -x : x', { x }, x < 0 ? -x : x);
    case 9: return { ...make('handler/assign', `x = ${n.source}`, { x }, undefined), handler: true, expectedState: { x: n.value } };
    case 10: return { ...make('handler/update', 'x++', { x }, undefined), handler: true, expectedState: { x: x + 1 } };
    case 11: return { ...make('handler/if', 'if (x >= 0) { x += 1; } else { x -= 1; }', { x }, undefined), handler: true, expectedState: { x: x >= 0 ? x + 1 : x - 1 } };
    case 12: return { ...make('handler/expression', 'items.slice(1)', { items: [1, 2, 3] }, undefined), handler: true, expectedState: { items: [1, 2, 3] } };
    default: {
      const [source, refused] = REFUSALS[family - COST_OPERATIONS.length - GRAMMAR_FAMILIES]!;
      return { ...make('refusal/' + refused, source, { items: [1, 2], x }, undefined), refused };
    }
  }
}
