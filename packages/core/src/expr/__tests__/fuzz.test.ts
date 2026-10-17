// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AssertionError } from 'node:assert';
import { COST_OPERATIONS, costCase } from './fuzz/cost-cases';
import { generateCase, MANDATORY_CASE_COUNT, randomSource } from './fuzz/generate';
import { CampaignFailure, executeCase, runCampaign, replayRegressions } from './fuzz/campaign';
import { runPreflight } from './fuzz/preflight';
import { runResiduals } from './fuzz/residuals';
import { regressions } from './fuzz/regressions';

// The standalone worker retains CampaignFailure's input/report metadata. The
// Vitest oracle must expose a real assertion without relabelling other failures.
function campaignAssertions<T>(run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof CampaignFailure && error.cause instanceof AssertionError) {
      error.cause.message = error.message;
      throw error.cause;
    }
    throw error;
  }
}

describe('FORMA-129 independent expression campaign', () => {
  it('keeps the named L50 current boundaries separate from historical thresholds', () => {
    const report = runResiduals();
    expect(report).toHaveLength(12);
    expect(report.filter(item => item.rows === 1717).every(item => !item.refused)).toBe(true);
    expect(report.filter(item => item.refused).map(item => item.rows)).toEqual([9200, 9200, 1500]);
  });
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
    const report = campaignAssertions(() => runCampaign(1290300, 1160));
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

  it('keeps numeric oracle failures as assertions with campaign context and worker metadata', () => {
    const input = { ...costCase('Array.from', 17), minimumCost: 1_000_000 };
    let cause: unknown;
    try { executeCase(input); } catch (error) { cause = error; }
    expect(cause).toBeInstanceOf(AssertionError);
    const report = { seed: 1290300, requested: 1160, completed: 59, admitted: 59, refused: 0, families: {}, astKinds: {}, elapsedMs: 1 };
    const failure = new CampaignFailure(report, 59, input, cause);
    expect(() => campaignAssertions(() => { throw failure; })).toThrowError(expect.objectContaining({
      name: 'AssertionError', code: 'ERR_ASSERTION',
      message: expect.stringContaining('expression campaign seed1290300 case59: cost undercharge'),
    }));
    expect(failure.report).toBe(report);
    expect(failure.input).toBe(input);
    expect(failure.index).toBe(59);
    const control = costCase('Array.from', 17), cost = executeCase(control).meter.cost;
    expect(executeCase({ ...control, minimumCost: cost }).meter.cost).toBe(cost);
    expect(() => executeCase({ ...control, expectedMeterCost: cost + 1 })).toThrowError(expect.objectContaining({ name: 'AssertionError', code: 'ERR_ASSERTION' }));
    expect(() => executeCase({ operation: 'meter-control', source: '1', state: {}, expected: 1, minimumCost: 0, initialMeter: { steps: 0, cost: 250_001 } })).toThrow('admitted case exceeds its meter');
  });

  it('does not turn ordinary campaign or infrastructure errors into assertion failures', () => {
    const report = { seed: 1290300, requested: 1160, completed: 0, admitted: 0, refused: 0, families: {}, astKinds: {}, elapsedMs: 0 };
    const input = costCase('Array.from', 17);
    for (const cause of [new Error('cost undercharge: infrastructure failure'), new TypeError('AssertionError: broken setup')]) {
      const failure = new CampaignFailure(report, 0, input, cause);
      let observed: unknown;
      try { campaignAssertions(() => { throw failure; }); } catch (error) { observed = error; }
      expect(observed).toBe(failure);
      expect(observed).not.toBeInstanceOf(AssertionError);
      expect(observed).toMatchObject({ name: 'Error', cause });
      expect(observed).not.toHaveProperty('code');
      expect(observed).not.toHaveProperty('matcherResult');
    }
  });

  it('preserves regression assertion identity and keeps setup errors ordinary', () => {
    const originalLength = regressions.length;
    try {
      regressions.push({ id: 'numeric-oracle-control', provenance: 'finite assertion control',
        input: { ...costCase('Array.from', 17), minimumCost: 1_000_000 } });
      expect(() => replayRegressions()).toThrowError(expect.objectContaining({
        name: 'AssertionError', code: 'ERR_ASSERTION',
        message: expect.stringContaining('expression regression numeric-oracle-control: cost undercharge'),
      }));
      regressions.length = originalLength;
      regressions.push({ id: 'uncloneable-setup-control', provenance: 'finite infrastructure control',
        input: { operation: 'setup-control', source: '1', state: { callback: () => 1 }, expected: 1, minimumCost: 0 } });
      let observed: unknown;
      try { replayRegressions(); } catch (error) { observed = error; }
      expect(observed).toMatchObject({ name: 'Error', message: 'expression regression uncloneable-setup-control',
        cause: expect.objectContaining({ name: 'DataCloneError' }) });
      expect(observed).not.toBeInstanceOf(AssertionError);
      expect(observed).not.toHaveProperty('code');
      expect(observed).not.toHaveProperty('matcherResult');
    } finally { regressions.length = originalLength; }
  });

  it('observes an admitted native and stops an over-budget bounded twin before it runs', async () => {
    vi.resetModules();
    try {
      expect(await runPreflight(() => import('../index'))).toEqual({ admittedNativeCalls: 1, refusedNativeCalls: 0, code: 'FORMA_E_BUDGET' });
    } finally { vi.resetModules(); }
  });
});
