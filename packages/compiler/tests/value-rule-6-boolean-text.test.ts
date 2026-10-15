/**
 * FORMA-182 rule 6, the compiled side: a boolean-typed value in a text
 * position is BUILD-614. String(flag) on a non-optional declared boolean prop
 * is the admitted near miss and binds DYN_TEXT to the boolean slot itself,
 * which the walker writes as the word (its suite reads `nearMissText`); on a
 * boolean signal it folds to the word. A literal, or a mixed expression whose
 * boolean result stands for nothing, writes nothing on both sides.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getSlots, parseOpcodeList } from './helpers/fmir';
import { cleanup, emitDeclaredPage, readVectors, refusal, textPage, visibleText, type TextVector } from './helpers/value-rules';
import { SLOT_TYPE_BOOL } from '../src/fmir-constants';

const booleans = readVectors<{ compiledText: TextVector[] }>('boolean-text.json');
afterEach(cleanup);

describe('rule 6 vectors: a boolean in text is a build error, String(flag) is the near miss', () => {
  it.each(booleans.compiledText.filter(vector => vector.code !== null))('$id refuses with $code', vector => {
    expect(() => emitDeclaredPage(textPage(vector))).toThrow(refusal(vector.code));
  });

  it.each(booleans.compiledText.filter(vector => vector.fix !== undefined))('$id: the advice in its message is $fix, and that builds', vector => {
    // String(…) where the compiler binds or folds it; a ternary where String(…)
    // is itself refused (an optional declared boolean, a closed value, a module const).
    const advice = vector.fix!.includes('String(') ? /write String\(…\) of it for the word/ : /write the word with a ternary/;
    expect(() => emitDeclaredPage(textPage(vector))).toThrow(advice);
    expect(emitDeclaredPage(textPage({ ...vector, child: vector.fix, code: null })).codes).toEqual([]);
  });

  it.each(booleans.compiledText.filter(vector => vector.code === null))('$id builds without a diagnostic and writes what the browser writes', vector => {
    const { binary, codes } = emitDeclaredPage(textPage(vector));
    expect(codes).toEqual([]);
    expect(visibleText(binary)).toBe(vector.writes);
    if (vector.slot) {
      expect(parseOpcodeList(binary).some(op => op.startsWith(`DYN_TEXT ${vector.slot} `))).toBe(true);
      expect(getSlots(binary).find(slot => slot.name === vector.slot)?.typeHint).toBe(SLOT_TYPE_BOOL);
    }
  });
});
