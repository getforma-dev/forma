/**
 * Byte oracles frozen from an earlier writer version.
 *
 * The header carries the writer's base version and a CRC covering it, so a new
 * minor release changes those bytes in every module it emits. These helpers
 * first require the current writer in the emitted header, then restore only the
 * writer fields and CRC to the frozen version with the independent bitwise
 * reference in scripts/fmir-corpus.mjs. The rest of the module must match the
 * oracle exactly; no expected payload is regenerated from the emitter.
 */
import { assertCurrentFmir, assertCurrentFmirHash } from '../../../../scripts/fmir-corpus.mjs';
import { COMPILER_WRITER_VERSION } from '../../src/fmir';

/** The writer that produced the hashes recorded before 3.1 (archives and baselines). */
export const FROZEN_WRITER = [3, 0, 0];

export function expectFrozenFmir(name: string, bytes: Uint8Array, frozenBytes: Uint8Array): void {
  assertCurrentFmir({ name, bytes, frozenBytes, expectedVersion: [...COMPILER_WRITER_VERSION] });
}

export function expectFrozenFmirHash(name: string, bytes: Uint8Array, frozenSha256: string): void {
  assertCurrentFmirHash({ name, bytes, frozenVersion: FROZEN_WRITER, frozenSha256, expectedVersion: [...COMPILER_WRITER_VERSION] });
}
