import type { GeneratedCase } from './generate';

/** Data-only bounded replays. Provenance names the original defended property;
 * the mutation replay is a killed qualification mutant, not a production bug. */
export const regressions: Array<{ id: string; provenance: string; input: GeneratedCase }> = [
  {
    id: 'removed-array-from-row-seed1290300-case37',
    provenance: 'FORMA-129 controls-mutant.json; original production cost row absent only in scratch source; numerical floor0<42',
    input: { operation: 'Array.from', source: 'Array.from(shape)', state: { shape: { length: 32 } }, expected: Array(32).fill(undefined), minimumCost: 42 },
  },
  {
    id: 'constructor-chain', provenance: 'FORMA-004 adversarial constructor-chain contract',
    input: { operation: 'regression/constructor', source: "({}).constructor.constructor('return 1')()", state: {}, expected: undefined, minimumCost: 0, refused: 'FORMA_E_KEY_DENIED' },
  },
  {
    id: 'grown-string-charge', provenance: 'FORMA-028 string-growth operator charge contract',
    input: { operation: 'regression/grow', source: 's + s', state: { s: 'a'.repeat(600) }, expected: 'a'.repeat(1200), minimumCost: 1200 / 128 },
  },
];
