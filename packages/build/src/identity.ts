/**
 * @getforma/build — the deployment identity (FORMA-186, DR-29; L-6 as amended
 * by L-56).
 *
 * A page names the build it was rendered for (`data-forma-build`), a bundle
 * carries the build it was compiled in (`__FORMA_BUILD__`), and core compares
 * the two before it activates anything. The identity is what both sides hold.
 *
 * It is computed FIRST, from every output of a first bundling pass (the
 * browser-facing files and the `.ir` modules) plus the writers' versions, and
 * only then compiled into the bundles, whose names hash content that includes
 * it. A hash over the finished manifest would be circular: the bundles carry
 * the identity and the manifest names them by content hash. Hashing the
 * outputs, rather than the sources, keeps the two properties that matter: an
 * edit that changes no output byte (a comment) leaves the identity and every
 * name alone, so no open tab is disturbed for nothing; and an identity that is
 * equal means the bundles are equal, which is what the pairing relies on.
 *
 * The previous release's `dist/` (retention) never reaches this function: the
 * identity does not depend on the retained set.
 */

import { createHash } from 'node:crypto';

/** Production identities: 16 lowercase hexadecimal characters (64 bits). */
export const IDENTITY_PATTERN = /^[0-9a-f]{16}$/;

/** Watch mode is a development build: one constant identity, no banner. */
export const DEV_IDENTITY = 'dev';

/** Bumped only if the pre-image below changes shape. */
const SCHEME = 'forma-build/1';

export interface IdentityWriter {
  name: string;
  version: readonly [number, number, number];
}

export interface IdentityFile {
  /** The output's base name. */
  name: string;
  bytes: Uint8Array;
}

/**
 * SHA-256 over the scheme, the writers (build, and the compiler for an SSR
 * build) and every file as `<byte length of name>:<name> NUL <sha256 of bytes>`,
 * files and writers sorted by name so the order a bundler lists them in never
 * matters. Names are length-prefixed and contents are hashed first, so no
 * choice of names and bytes can read as another.
 *
 * Verified by: packages/build/tests/identity.test.ts > "is 16 lowercase hex characters, the same for the same inputs in any order"
 * Verified by: packages/build/tests/identity.test.ts > "cannot be forged by moving bytes between a name and its content"
 */
export function computeIdentity(input: { writers: readonly IdentityWriter[]; files: readonly IdentityFile[] }): string {
  const hash = createHash('sha256');
  const byName = <T extends { name: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  hash.update(`${SCHEME}\n`);
  for (const writer of [...input.writers].sort(byName)) hash.update(`writer ${writer.name}@${writer.version.join('.')}\n`);
  for (const file of [...input.files].sort(byName)) {
    hash.update(`file ${Buffer.byteLength(file.name)}:${file.name}\0${createHash('sha256').update(file.bytes).digest('hex')}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * The comment that makes every JavaScript output carry the identity, so every
 * deploy renames every bundle (L-6): a name pins one build. The constant core
 * reads is esbuild's `define`, which lands only in files that use it.
 */
export const IDENTITY_BANNER_HEAD = /^\/\*forma-build:[0-9a-f]{16}\*\/\n?/;

export function identityBanner(identity: string): string {
  if (!IDENTITY_PATTERN.test(identity)) throw new Error(`@getforma/build: not a deployment identity: ${JSON.stringify(identity)}`);
  return `/*forma-build:${identity}*/`;
}
