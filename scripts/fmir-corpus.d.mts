// Types for fmir-corpus.mjs, for strict TypeScript callers such as e2e/parity.
export function referenceCrc32(...chunks: Uint8Array[]): number;
export function packageWriter(version: string): number[];
export function assertCurrentFmir(options: {
  name: string;
  bytes: Uint8Array;
  frozenBytes: Uint8Array;
  expectedVersion: readonly number[];
}): void;
export function assertCurrentFmirHash(options: {
  name: string;
  bytes: Uint8Array;
  frozenVersion: readonly number[];
  frozenSha256: string;
  expectedVersion: readonly number[];
}): void;
