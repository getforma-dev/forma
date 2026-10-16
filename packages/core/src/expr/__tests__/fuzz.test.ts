// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { COST_OPERATIONS, costCase } from './fuzz/cost-cases';
import { generateCase, MANDATORY_CASE_COUNT, randomSource } from './fuzz/generate';
import { executeCase, runCampaign, replayRegressions } from './fuzz/campaign';
import { runPreflight } from './fuzz/preflight';

describe('FORMA-129 independent expression campaign', () => {
  it('replays every committed bounded regression', () => {
    expect(replayRegressions()).toEqual(['removed-array-from-row-seed1290300-case37', 'constructor-chain', 'grown-string-charge']);
  });
  it('replays every cost row against a known semantic value and independent floor', () => {
    for (const operation of COST_OPERATIONS) {
      for (const length of [1, 17, 64]) {
        const result = executeCase(costCase(operation, length));
        expect(result.refused, `${operation} admitted control`).toBe(false);
      }
    }
  });

  it('has deterministic source, data and expectations for a seed', () => {
    const a = randomSource(1290300);
    const b = randomSource(1290300);
    for (let i = 0; i < 2 * MANDATORY_CASE_COUNT; i++) {
      expect(generateCase(a, i)).toEqual(generateCase(b, i));
    }
  });

  it('executes a per-merge seed with every AST kind, all cost rows and coded refusals', () => {
    const report = runCampaign(1290300, 1160);
    expect(report.completed).toBe(report.requested);
    expect(report.admitted + report.refused).toBe(1160);
    expect(Object.keys(report.astKinds).sort()).toEqual([
      'ArrayLit', 'Arrow', 'Assign', 'Binary', 'Call', 'Computed', 'Conditional',
      'ExprStmt', 'Identifier', 'If', 'Literal', 'Logical', 'Member', 'ObjectLit',
      'Template', 'Unary', 'Update',
    ]);
  });

  it('fails a connected oracle when a known positive floor exceeds the actual charge', () => {
    const input = costCase('Array.from', 17);
    expect(executeCase(input).meter.cost).toBeGreaterThanOrEqual(input.minimumCost);
    expect(() => executeCase({ ...input, minimumCost: 1_000_000 })).toThrow('cost undercharge');
  });

  it('observes an admitted native and stops an over-budget bounded twin before it runs', async () => {
    vi.resetModules();
    try {
      expect(await runPreflight(() => import('../index'))).toEqual({ admittedNativeCalls: 1, refusedNativeCalls: 0, code: 'FORMA_E_BUDGET' });
    } finally { vi.resetModules(); }
  });
});
