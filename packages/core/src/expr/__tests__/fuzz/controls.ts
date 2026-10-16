import type { GeneratedCase } from './generate';

export const CONTROL_COUNT = 12;

/** Operator and cumulative-boundary controls use small actual results even at
 * the allocation limit, by handing in an already-spent real task meter. */
export function controlCase(index: number, size: number): GeneratedCase {
  const s = 'a'.repeat(size);
  const make = (operation: string, source: string, state: Record<string, unknown>, expected: unknown, minimumCost: number): GeneratedCase =>
    ({ operation, source, state, expected, minimumCost });
  switch (index) {
    case 0: return make('operator/grow', 's + s', { s }, s + s, 2 * size / 128);
    case 1: return make('operator/template', '`${s}${s}`', { s }, s + s, 2 * size / 128);
    case 2: return { ...make('operator/compound', 's += s', { s }, undefined, 2 * size / 128), handler: true, expectedState: { s: s + s } };
    case 3: return make('operator/compare', 's === t', { s, t: s.slice(0, -1) + 'b' }, false, size / 128);
    case 4: {
      const text = '1'.repeat(64);
      return make('operator/parse', '+s', { s: text }, Number(text), 64 / 8);
    }
    case 5: return make('operator/fresh-copy', "(s + 'x').charCodeAt(0)", { s: 'a'.repeat(128) }, 97, 8 + 129 / 32);
    case 6: return make('meter/nested', 'xs.map(x => Array.from({length: x}).length)', { xs: [4, 8, 16] }, [4, 8, 16], 3 + 14 + 18 + 26);
    case 7: return make('meter/sequential', 's.repeat(2) + s.repeat(3)', { s }, s.repeat(5), 5 * size + 5 * size / 128);
    case 8: return {
      ...make('boundary/allocation-admitted', 'Array.from(shape)', { shape: { length: 4 } }, Array(4).fill(undefined), 250_000),
      initialMeter: { steps: 0, cost: 249_986 }, expectedMeterCost: 250_000,
    };
    case 9: return {
      ...make('boundary/allocation-refused', 'Array.from(shape)', { shape: { length: 4 } }, undefined, 0),
      initialMeter: { steps: 0, cost: 249_990 }, expectedMeterCost: 249_990, refused: 'FORMA_E_BUDGET',
    };
    case 10: return {
      ...make('boundary/steps-admitted', '1', {}, 1, 0), initialMeter: { steps: 99_999, cost: 0 },
    };
    case 11: return {
      ...make('boundary/steps-refused', 'x + 1', { x: 1 }, undefined, 0),
      initialMeter: { steps: 99_999, cost: 0 }, expectedMeterCost: 0, refused: 'FORMA_E_BUDGET',
    };
    default: throw new Error(`unknown control ${index}`);
  }
}
