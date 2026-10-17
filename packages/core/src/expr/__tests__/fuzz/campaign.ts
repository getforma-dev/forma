import { deepStrictEqual, strictEqual } from 'node:assert';
import { compileExpression, compileHandler, evaluateExpression, runHandler, isExprError, LIMITS, type Meter } from '../../index';
import { COSTS } from '../../cost';
import { COST_OPERATIONS } from './cost-cases';
import { generateCase, randomSource, MANDATORY_CASE_COUNT, type GeneratedCase } from './generate';
import { regressions } from './regressions';

export interface CampaignReport {
  seed: number;
  requested: number;
  completed: number;
  admitted: number;
  refused: number;
  families: Record<string, number>;
  astKinds: Record<string, number>;
  elapsedMs: number;
}

const EXPR_KINDS = ['Literal', 'Identifier', 'Template', 'ArrayLit', 'ObjectLit', 'Unary', 'Binary', 'Logical', 'Conditional', 'Member', 'Computed', 'Call', 'Arrow'];
const STMT_KINDS = ['ExprStmt', 'Assign', 'Update', 'If'];

function recordKinds(node: unknown, counts: Record<string, number>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) recordKinds(item, counts); return; }
  const record = node as Record<string, unknown>;
  if (typeof record.k === 'string') counts[record.k] = (counts[record.k] ?? 0) + 1;
  for (const [key, value] of Object.entries(record)) if (!(key === 'value' && record.k === 'Literal')) recordKinds(value, counts);
}

export function executeCase(input: GeneratedCase, astKinds: Record<string, number> = {}): { refused: boolean; meter: Meter } {
  const state = structuredClone(input.state);
  const getters: Record<string, () => unknown> = Object.create(null);
  const setters: Record<string, (value: unknown) => void> = Object.create(null);
  for (const key of Object.keys(state)) {
    getters[key] = () => state[key];
    setters[key] = value => { state[key] = value; };
  }
  const meter: Meter = { ...(input.initialMeter ?? { steps: 0, cost: 0 }) };
  let value: unknown;
  let refusal: string | undefined;
  try {
    if ('handler' in input && input.handler) {
      const program = compileHandler(input.source);
      recordKinds(program, astKinds);
      runHandler(program, { getters, setters }, meter);
    } else {
      const expression = compileExpression(input.source);
      recordKinds(expression, astKinds);
      value = evaluateExpression(expression, { getters, setters }, meter);
    }
  } catch (error) {
    if (!isExprError(error)) throw error;
    refusal = error.code;
  }
  const expectedRefusal = 'refused' in input ? input.refused : undefined;
  strictEqual(refusal, expectedRefusal, `refusal: expected ${expectedRefusal ?? 'admitted'}, received ${refusal ?? 'admitted'}`);
  if (input.expectedMeterCost !== undefined && meter.cost !== input.expectedMeterCost) {
    throw new Error(`meter cost: expected ${input.expectedMeterCost}, received ${meter.cost}`);
  }
  if (refusal) return { refused: true, meter };
  deepStrictEqual(value, input.expected, 'generated expression value');
  if ('expectedState' in input && input.expectedState) deepStrictEqual(state, input.expectedState, 'generated handler state');
  if (!Number.isFinite(meter.cost) || meter.cost < input.minimumCost) {
    throw new Error(`cost undercharge for ${input.operation}: actual ${meter.cost}, independent floor ${input.minimumCost}`);
  }
  if (meter.cost > LIMITS.ALLOC_BUDGET || meter.steps < 1 || meter.steps > LIMITS.STEP_BUDGET) {
    throw new Error(`admitted case exceeds its meter: ${JSON.stringify(meter)}`);
  }
  return { refused: false, meter };
}

export class CampaignFailure extends Error {
  constructor(readonly report: CampaignReport, readonly index: number, readonly input: GeneratedCase, cause: unknown) {
    super(`expression campaign seed${report.seed} case${index}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

export function replayRegressions(): string[] {
  for (const { id, input } of regressions) {
    try { executeCase(input); } catch (cause) { throw new Error(`expression regression ${id}`, { cause }); }
  }
  return regressions.map(item => item.id);
}

/** All expectations are assertions; caught non-engine exceptions remain failures. */
export function runCampaign(seed: number, count: number, progress?: (report: CampaignReport) => void): CampaignReport {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff || !Number.isInteger(count) || count < MANDATORY_CASE_COUNT || count > 1_000_000) {
    throw new Error(`campaign requires a uint32 seed and${MANDATORY_CASE_COUNT}–1,000,000 cases`);
  }
  const start = performance.now();
  const report: CampaignReport = { seed, requested: count, completed: 0, admitted: 0, refused: 0, families: {}, astKinds: {}, elapsedMs: 0 };
  const random = randomSource(seed);
  for (let index = 0; index < count; index++) {
    const input = generateCase(random, index);
    try {
      const result = executeCase(input, report.astKinds);
      report.completed++;
      result.refused ? report.refused++ : report.admitted++;
      report.families[input.operation] = (report.families[input.operation] ?? 0) + 1;
      if (report.completed % 10_000 === 0) {
        report.elapsedMs = performance.now() - start;
        progress?.(report);
      }
    } catch (cause) {
      report.elapsedMs = performance.now() - start;
      throw new CampaignFailure(report, index, input, cause);
    }
  }
  // Deliberately after numeric checks: a removed-row mutation must be caught by
  // its independent charge assertion, not merely by this inventory comparison.
  deepStrictEqual(Object.keys(COSTS).sort(), [...COST_OPERATIONS].sort(), 'cost table coverage');
  for (const operation of COST_OPERATIONS) if (!report.families[operation]) throw new Error(`unexercised cost row ${operation}`);
  for (const kind of [...EXPR_KINDS, ...STMT_KINDS]) if (!report.astKinds[kind]) throw new Error(`unexercised AST kind ${kind}`);
  if (!report.admitted || !report.refused) throw new Error('campaign has no admitted or refused cases');
  report.elapsedMs = performance.now() - start;
  return report;
}
