/**
 * @getforma/build — asset retention (FORMA-186, DR-29, L-25; L-16 and SR45 for a
 * security release).
 *
 * During a rolling deploy, and for as long as a tab stays open, a page of one
 * release asks for hashed files that the next release's binary does not embed.
 * The application's pipeline keeps the previous release's `dist/` as a release
 * artifact and passes its path (`previousDist`); the build copies that release's
 * own hashed assets into the new `dist/` and lists them in the new manifest
 * `retained` and `immutable`, so `serve_asset` serves them as it serves any
 * immutable asset and the application embeds one `dist/`. It is one generation:
 * what the previous release itself retained is not copied again, so the assets
 * at most double.
 *
 * The previous `dist/` is an input from outside the build, and what it holds is
 * executed by browsers under this release's name. Every file is therefore
 * checked against the SHA-384 the previous manifest recorded for it, and a
 * listed file that is missing, linked, or altered fails the build (`BUILD-821`)
 * rather than being re-blessed by a manifest that hashes whatever was copied.
 * A path that is not a usable previous release fails it too (`BUILD-820`).
 * Nothing is copied for a first deploy (no `previousDist`) or for a release
 * marked security (L-16, SR45): the build never reaches this module.
 *
 * Retention runs inside the staging directory, so a failure leaves the previous
 * output exactly as it was (L-21). It cannot move the deployment identity: the
 * identity is fixed by a pass that never sees the previous `dist/`.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The previous release, read and checked, not yet copied. */
export interface PreviousRelease {
  /** Where its files are. */
  dir: string;
  /** Its `manifest.json` build, for the build's log line. */
  build: string;
  /** The hashed files that are candidates for retention, with their recorded digests. */
  candidates: { name: string; integrity: string }[];
  /** Why nothing will be retained, when that is not an error (schema 1: the first 3.0.0 deploy). */
  note?: string;
}

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
/** Never retained: the manifest and worker are the new build's own, and `.ir` modules are server input. */
const NEVER = (name: string) => name === 'manifest.json' || name === 'sw.js' || name.endsWith('.ir');

const sha384 = (bytes: Uint8Array) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

function realOrResolved(path: string): string {
  // The output directory may not exist yet: resolve its nearest existing ancestor.
  const absolute = resolve(path);
  for (let current = absolute, rest = ''; ; rest = join(basename(current), rest), current = dirname(current)) {
    if (existsSync(current)) return join(realpathSync(current), rest);
    if (dirname(current) === current) return absolute;
  }
}

/** Whether `inner` is `outer` or inside it. */
function within(inner: string, outer: string): boolean {
  const path = relative(outer, inner);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * Read and check the previous release before anything is bundled, so a wrong
 * path fails the build at once. `outputDir` is the directory the build replaces
 * whole, which the previous release must not be, hold or sit in (finding: a
 * pipeline that restores the previous dist into `outputDir` would lose it).
 *
 * Verified by: packages/build/tests/retention.test.ts > "refuses %s (BUILD-820)"
 * Verified by: packages/build/tests/retention.test.ts > "refuses a previous dist that is, contains or is inside the output directory (BUILD-820)"
 * Verified by: packages/build/tests/retention.test.ts > "retains nothing, and says so, from a manifest that is not schema 2 (the first 3.0.0 deploy)"
 */
export function readPreviousDist(previousDist: string, outputDir: string, app: string): PreviousRelease {
  const dir = resolve(previousDist);
  const fail = (message: string): never => { throw new Error(`BUILD-820 previousDist ${JSON.stringify(previousDist)}: ${message}`); };
  if (!existsSync(dir)) fail('does not exist; pass the directory of the release that is live, or leave previousDist out for a first deploy');
  const real = realpathSync(dir);
  if (!lstatSync(real).isDirectory()) fail('is not a directory');
  const output = realOrResolved(outputDir);
  if (within(real, output) || within(output, real)) {
    fail(`overlaps outputDir ${JSON.stringify(outputDir)}, which the build replaces whole; keep the previous release in another directory`);
  }
  const manifestPath = join(real, 'manifest.json');
  if (!existsSync(manifestPath)) fail('holds no manifest.json; it is not a build output');
  let manifest: unknown;
  try {
    const stat = lstatSync(manifestPath);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('not a regular file within 16 MiB');
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return fail(`manifest.json cannot be read (${(error as Error).message})`);
  }
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(manifest)) return fail('manifest.json is not an object');
  const build = typeof manifest.build === 'string' ? manifest.build : '';
  if (manifest.version !== 2) {
    return { dir: real, build, candidates: [], note: `the previous dist's manifest is not schema 2 (version ${JSON.stringify(manifest.version)}): nothing is retained from it` };
  }
  if (manifest.app !== app) fail(`is application ${JSON.stringify(manifest.app)}'s dist, not ${JSON.stringify(app)}'s`);
  if (build === 'dev') fail('is a watch build (build "dev"), not a release');
  if (!object(manifest.assets)) fail('manifest.json has no assets object');
  const candidates: PreviousRelease['candidates'] = [];
  for (const name of Object.keys(manifest.assets as Record<string, unknown>).sort()) {
    const meta = (manifest.assets as Record<string, unknown>)[name];
    if (NEVER(name) || !object(meta) || meta.immutable !== true || meta.retained === true) continue;
    // The build writes flat names; a name that is not one could leave the directory.
    if (name !== basename(name) || name.startsWith('.') || /[\\/:?#\u0000-\u001f\u007f]/.test(name)) fail(`manifest.json lists an asset named ${JSON.stringify(name)}, which is not a flat file name`);
    if (typeof meta.integrity !== 'string') fail(`manifest.json records no integrity for ${JSON.stringify(name)}`);
    candidates.push({ name, integrity: meta.integrity as string });
  }
  return { dir: real, build, candidates };
}

/**
 * Copy the previous release's candidates into `staging`, after the new build's
 * own files are hashed and before they are compressed (so the retained files get
 * the same compressed siblings as any asset). A candidate the new build also
 * emitted under the same name is the new build's own file, if its bytes are the
 * recorded ones; the same name with other bytes fails.
 *
 * Verified by: packages/build/tests/retention.test.ts > "copies hashed immutable files, and never .ir, sw.js, manifest.json, mutable files or what the previous build retained"
 * Verified by: packages/build/tests/retention.test.ts > "treats a file both builds emit as the new build's own, and refuses the same name with other bytes (BUILD-821)"
 * Verified by: packages/build/tests/retention.test.ts > "refuses bytes that do not match the recorded SHA-384, a missing file, a link and a directory (BUILD-821)"
 */
export function retainFrom(previous: PreviousRelease, staging: string): { retained: Set<string> } {
  const retained = new Set<string>();
  const fail = (name: string, message: string): never => { throw new Error(`BUILD-821 retained asset ${JSON.stringify(name)}: ${message}`); };
  for (const { name, integrity } of previous.candidates) {
    const target = join(staging, name);
    if (existsSync(target)) {
      if (sha384(readFileSync(target)) !== integrity) fail(name, 'this build emitted a file of the same name with other bytes than the previous release recorded (SHA-384 mismatch); a hashed name must mean one content');
      continue;
    }
    const source = join(previous.dir, name);
    let stat;
    try { stat = lstatSync(source); } catch { return fail(name, 'is listed in the previous manifest but is missing from the previous dist; keep the whole release artifact'); }
    if (!stat.isFile()) fail(name, 'is not a regular file in the previous dist (a link or a directory is not retained)');
    const bytes = readFileSync(source);
    if (sha384(bytes) !== integrity) fail(name, 'its bytes no longer match the SHA-384 the previous manifest recorded; the previous dist was altered or damaged, and the build will not vouch for it');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    retained.add(name);
  }
  return { retained };
}
