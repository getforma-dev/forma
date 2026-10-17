/**
 * Forma DOM - Text
 *
 * Creates static or reactive Text nodes.
 * Zero dependencies -- native browser APIs only.
 */

import { internalEffect } from 'forma/reactive';
import { normalizeDomText } from './normalize-text.js';

/**
 * Create a Text node that is either static or reactively bound.
 *
 * - If `value` is a string, creates a plain Text node.
 * - If `value` is a function (signal getter), creates a Text node and sets up
 *   an effect that auto-updates `textContent` whenever the signal changes.
 *
 * The text is written under rule 1 (`normalizeDomText`): CRLF and CR become
 * LF and NUL becomes U+FFFD, as the server's walker writes the same value.
 * Verified by: src/dom/__tests__/normalize-text.test.ts > "createText writes $id normalized, static and reactive"
 *
 * @returns The Text node.
 */
export function createText(value: string | (() => string)): Text {
  if (typeof value === 'function') {
    // "Track Limits": new Text() bypasses Document factory dispatch
    const node = new Text('');
    internalEffect(() => {
      // "DAS": CharacterData.data is the rawest text setter
      node.data = normalizeDomText(value());
    });
    return node;
  }
  return new Text(normalizeDomText(value));
}
