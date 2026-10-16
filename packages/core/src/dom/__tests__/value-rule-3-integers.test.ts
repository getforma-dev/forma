/**
 * FORMA-182 rule 3: integers within plus or minus (2^53 - 1), refused beyond.
 * The server's admission is forma-ir's (tests/page_props.rs on the same
 * vectors); here the engine confirms the boundary is the safe-integer range,
 * that an admitted value survives the JSON envelope exactly, and that a float
 * origin formats by rule 2 whatever its magnitude.
 */
import { describe, expect, it } from 'vitest';
import { h } from '../element.js';
import { readVectors } from './value-rule-vectors.js';

interface IntegerVector { id: string; kind: 'i64' | 'u64'; lexeme: string; admitted: boolean }
interface FloatOriginVector { id: string; lexeme: string; expected: string }
const integers = readVectors<{ exact: IntegerVector[]; floatOrigin: FloatOriginVector[] }>('integers.json');
const MAX_SAFE = 2n ** 53n - 1n;

describe('rule 3 vectors: integers within plus or minus (2^53 - 1)', () => {
  it.each(integers.exact)('$id: the vector agrees with the safe-integer range, and an admitted value survives the envelope exactly', ({ lexeme, admitted }) => {
    const exact = BigInt(lexeme);
    expect(admitted).toBe(exact >= -MAX_SAFE && exact <= MAX_SAFE);
    if (admitted) {
      const parsed = JSON.parse(lexeme) as number;
      expect(Number.isSafeInteger(parsed)).toBe(true);
      expect(BigInt(parsed)).toBe(exact);
      expect(String(parsed)).toBe(lexeme);
      expect(h('p', null, parsed).textContent).toBe(lexeme);
    } else {
      // Past the boundary the engine's number is not a safe integer: a
      // neighbour shares its binary64, so the digits could not be trusted.
      expect(Number.isSafeInteger(Number(lexeme))).toBe(false);
    }
  });

  it.each(integers.floatOrigin)('$id: a float origin is admitted whatever its magnitude and formats by rule 2', ({ lexeme, expected }) => {
    const n = Number(lexeme);
    expect(Number.isFinite(n)).toBe(true);
    expect(String(n)).toBe(expected);
    expect(h('p', null, n).textContent).toBe(expected);
  });
});
