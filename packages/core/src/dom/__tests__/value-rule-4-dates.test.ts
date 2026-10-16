/**
 * FORMA-182 rule 4: dates as epoch milliseconds, no Intl on the server. The
 * engine's Date is the oracle for the admission range (TimeClip) and for
 * truncation toward zero; forma-ir's tests/page_props.rs encodes the same
 * vectors from SystemTime, and the compiler's suite refuses a declared Date in
 * any text position.
 */
import { describe, expect, it } from 'vitest';
import { readVectors } from './value-rule-vectors.js';

interface EpochVector { id: string; lexeme: string; admitted: boolean }
interface TruncationVector { id: string; sign: 1 | -1; millis: number; nanos: number; expected: string }
const dates = readVectors<{ epochMs: EpochVector[]; truncation: TruncationVector[] }>('dates.json');

describe('rule 4 vectors: dates as epoch milliseconds', () => {
  it.each(dates.epochMs)('$id: Date accepts exactly what the server admits', ({ lexeme, admitted }) => {
    const ms = Number(lexeme);
    const time = new Date(ms).getTime();
    if (admitted) expect(time).toBe(ms);
    else expect(Number.isNaN(time)).toBe(true);
  });

  it.each(dates.truncation)('$id: a fractional millisecond is truncated toward zero on both sides', ({ sign, millis, nanos, expected }) => {
    const time = new Date(sign * (millis + nanos / 1e6)).getTime();
    expect(String(time)).toBe(expected);
  });
});
