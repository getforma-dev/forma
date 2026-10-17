/**
 * FORMA-182 rule 4, the compiled side: a declared Date never becomes text or
 * an attribute on the server, bare or through String(), so no server locale
 * or ICU table can reach the page. The same vector file carries the epoch
 * range forma-ir and core check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, emitDeclaredPage, readVectors, refusal, textPage, type TextVector } from './helpers/value-rules';

const dates = readVectors<{ compiledText: TextVector[] }>('dates.json');
afterEach(cleanup);

describe('rule 4 vectors: a declared Date never becomes text on the server', () => {
  it.each(dates.compiledText)('$id refuses with $code', vector => {
    expect(() => emitDeclaredPage(textPage(vector))).toThrow(refusal(vector.code));
  });
});
