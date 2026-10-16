/**
 * FORMA-182 rule 7, the compiled side: a createShow condition or a ternary
 * test must be boolean-typed; a declared, closed, signal or literal source the
 * compiler can prove is of another type is BUILD-615. An admitted shape emits
 * SHOW_IF on a TYPE_BOOL slot, which the walker selects the branch by (its
 * suite reads `walker`), and shows the branch the browser shows.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getSlots, parseOpcodeList } from './helpers/fmir';
import { cleanup, conditionPage, emitDeclaredPage, readVectors, refusal, visibleText, type ConditionVector } from './helpers/value-rules';
import { SLOT_TYPE_BOOL } from '../src/fmir-constants';

const conditions = readVectors<{ compiledCondition: ConditionVector[] }>('conditions.json');
afterEach(cleanup);

describe('rule 7 vectors: conditions are boolean-typed', () => {
  it.each(conditions.compiledCondition.filter(vector => vector.code !== null))('$id refuses with $code', vector => {
    expect(() => emitDeclaredPage(conditionPage(vector))).toThrow(refusal(vector.code));
    if (vector.message) expect(() => emitDeclaredPage(conditionPage(vector))).toThrow(vector.message);
  });

  it.each(conditions.compiledCondition.filter(vector => vector.code === null))('$id builds a SHOW_IF on a boolean slot and shows the branch the browser shows', vector => {
    const { binary, codes } = emitDeclaredPage(conditionPage(vector));
    expect(codes).toEqual(vector.diagnostics ?? []);
    const show = parseOpcodeList(binary).find(op => op.startsWith('SHOW_IF '));
    expect(show).toBeDefined();
    const slotName = show!.split(' ')[1]!;
    expect(getSlots(binary).find(entry => entry.name === slotName)?.typeHint, `slot ${slotName}`).toBe(SLOT_TYPE_BOOL);
    if (vector.writes !== undefined) expect(visibleText(binary)).toBe(vector.writes);
  });
});
