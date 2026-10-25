/**
 * Whether the compiler's module for a corpus entry and its committed module are one pair.
 *
 * Committed modules keep the writer that froze them. A newer minor release writes its own
 * version and CRC into the header, so the comparison restores only those fields (with the
 * independent reference in scripts/fmir-corpus.mjs) and requires every other byte to match.
 * The committed module, which the current reader accepts, stays the one that is served.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertCurrentFmir, packageWriter } from '../../../scripts/fmir-corpus.mjs';
import { REPO } from './server.mts';

const WRITER = packageWriter(JSON.parse(readFileSync(resolve(REPO, 'packages/compiler/package.json'), 'utf8')).version);

/** Null when they pair; otherwise why not. */
export function pairDifference(name: string, compiled: Uint8Array, committed: Uint8Array): string | null {
  try {
    assertCurrentFmir({ name, bytes: compiled, frozenBytes: committed, expectedVersion: WRITER });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
