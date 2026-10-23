/**
 * @getforma/build — coded SSR publication diagnostics and the JSON report
 * (FORMA-119; DR-1, N12)
 *
 * The compiler reports every construct it cannot represent with a stable
 * code, file, line and column, and still prints the line it printed before.
 * The build gathers them from every page, returns them in its result, writes
 * them as JSON on request, and fails with all available errors at
 * once, after every page has been compiled, rather than at the first.
 *
 * Verified by: packages/build/tests/strict.test.ts
 */

import { randomBytes } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { BuildConfig, BuildDiagnostic } from './types.js';

/** A diagnostic as `@getforma/compiler` hands it over (0.3.7 and later). */
export interface CompilerDiagnostic {
  code: string;
  file: string;
  line: number;
  column: number;
  message: string;
  why: string;
  fix: string;
  strict: boolean;
  chain?: BuildDiagnostic['chain'];
}

/** Where the published subset and catalogue live. */
export const CATALOGUE_URL = 'https://github.com/getforma-dev/forma/blob/main/packages/compiler/docs/subset.md';

/**
 * 3.0 always rejects unsupported native constructs. The old config and
 * environment switches remain accepted no-ops through 3.x; invalid environment
 * spellings still fail rather than being mistaken for a valid option.
 * `diagnosticsJson` remains config only. No command-line flag is read here.
 * Verified by: packages/build/tests/strict-only.test.ts > "accepts old false flags as no-ops while reporting the effective strict mode"
 */
export function resolveDiagnosticOptions(
  config: BuildConfig,
  env: NodeJS.ProcessEnv = process.env,
): { strict: boolean; diagnosticsJson?: string } {
  if (config.strict === undefined) {
    const value = env.FORMA_STRICT;
    if (value !== undefined && !['', '0', 'false', '1', 'true'].includes(value)) {
      throw new Error(
        `@getforma/build: FORMA_STRICT is '${value}': use 0, 1, false or true, or unset it; 3.0 always rejects unsupported SSR constructs`,
      );
    }
  }
  return { strict: true, ...(config.diagnosticsJson ? { diagnosticsJson: config.diagnosticsJson } : {}) };
}

/**
 * The diagnostics of one build, page by page. A page's latest compilation
 * replaces its earlier one, so in watch mode the list describes the modules
 * as they are now. Pages are listed in the order of the config's entries,
 * whichever finished compiling first, so the report is the same every run.
 */
export class DiagnosticsCollector {
  private readonly byPage = new Map<string, BuildDiagnostic[]>();
  private readonly buildLevel: BuildDiagnostic[] = [];

  constructor(_strict: boolean, private readonly pageOrder: readonly string[] = []) {}

  /** The SSR plugin's `onDiagnostics` callback. */
  readonly onDiagnostics = (diagnostics: CompilerDiagnostic[], page: string): void => {
    this.byPage.set(page, diagnostics.map((d) => this.toBuildDiagnostic(d, page)));
  };

  /** A diagnostic the build itself reports, not a page's. */
  addBuildLevel(diagnostic: CompilerDiagnostic): void {
    this.buildLevel.push(this.toBuildDiagnostic(diagnostic, ''));
  }

  /** Every diagnostic: the build's own first, then each page's in build order. */
  all(): BuildDiagnostic[] {
    const rank = (page: string) => {
      const i = this.pageOrder.indexOf(page);
      return i === -1 ? this.pageOrder.length : i;
    };
    const pages = [...this.byPage.keys()].sort((a, b) => rank(a) - rank(b));
    return [...this.buildLevel, ...pages.flatMap((page) => this.byPage.get(page)!)];
  }

  /** The diagnostics that refuse publication. */
  errors(): BuildDiagnostic[] {
    return this.all().filter((d) => d.severity === 'error');
  }

  private toBuildDiagnostic(d: CompilerDiagnostic, page: string): BuildDiagnostic {
    return {
      code: d.code,
      severity: d.strict ? 'error' : 'note',
      page,
      file: d.file,
      line: d.line,
      column: d.column,
      message: d.message,
      why: d.why,
      fix: d.fix,
      ...(d.chain ? { chain: d.chain } : {}),
    };
  }
}

/**
 * Whether `report` lies inside `outputDir`, as the filesystem sees them: both
 * through their real paths (a symlink or junction pointing into `outputDir`
 * counts as inside), compared case-insensitively where the filesystem ignores
 * case, and with `..` counted only as a whole path segment (`dist/..d.json`
 * is inside `dist`). Either path may not exist yet: its nearest existing
 * ancestor is resolved, and the rest is taken as written. Both are compared in
 * Unicode normalization form C (FORMA-245): macOS APFS names a directory once
 * whether it is spelled composed (NFC) or decomposed (NFD), so an NFD report
 * path under an NFC `outputDir` that does not exist yet (nothing for realpath
 * to canonicalize) is still inside. Only the comparison is normalized, never
 * a path used for I/O. On a filesystem that keeps the two spellings apart the
 * result is a refusal of a report that was technically beside `outputDir`,
 * the safe direction, and the message tells the user to write it elsewhere.
 * Verified by: packages/build/tests/strict.test.ts > "counts an NFD report inside an NFC outputDir that does not exist yet, and the reverse"
 * Verified by: packages/build/tests/strict.test.ts > "refuses a JSON report path inside outputDir, before anything is written"
 */
export function isInsideOutputDir(report: string, outputDir: string): boolean {
  const out = realPathOf(outputDir);
  const target = realPathOf(report);
  const fold = caseInsensitiveAt(out.existing);
  const outPath = out.path.normalize('NFC');
  const targetPath = target.path.normalize('NFC');
  const rel = fold
    ? relative(outPath.toLowerCase(), targetPath.toLowerCase())
    : relative(outPath, targetPath);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** `path` with its nearest existing ancestor through realpath, and that ancestor. */
function realPathOf(path: string): { path: string; existing: string } {
  let current = resolve(path);
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    rest.unshift(basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync.native(current);
  } catch {
    // An unreadable ancestor is compared as written.
  }
  return { path: rest.length ? join(real, ...rest) : real, existing: real };
}

/**
 * Whether the filesystem holding `dir` (an existing path) ignores case: the
 * same path with one letter's case flipped names the same file. A path with
 * no letter is taken as case-sensitive.
 */
function caseInsensitiveAt(dir: string): boolean {
  const i = dir.search(/[A-Za-z][^A-Za-z]*$/);
  if (i < 0) return false;
  const c = dir[i]!;
  const flipped = dir.slice(0, i) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + dir.slice(i + 1);
  try {
    const a = statSync(dir);
    const b = statSync(flipped);
    return a.ino === b.ino && a.dev === b.dev;
  } catch {
    return false;
  }
}

/** The report's format version. A field may be added without a change;
 *  renaming or removing a field, or changing what one means, increments it. */
export const DIAGNOSTICS_JSON_VERSION = 1;

/**
 * Why the report cannot be written, when a directory it needs is a symbolic
 * link (a junction on Windows) to nothing, else `undefined` (FORMA-245). Without
 * this `mkdir -p` fails with a bare `ENOENT ... mkdir '<link>'` that names
 * neither the link nor what it points at. Walks up from the report's directory
 * to the nearest existing ancestor and checks each missing step: a link that
 * exists but points at an existing directory is followed on purpose (`mkdir -p`
 * creates what is missing there), as `isInsideOutputDir` follows it. Plain
 * message, not a coded diagnostic, like the report-inside-outputDir refusal
 * beside it: it describes the user's path, not an SSR construct.
 * Verified by: packages/build/tests/strict.test.ts > "refuses a report whose parent is a link to nothing, naming the link and where it points, before creating anything"
 */
export function danglingReportParent(report: string): string | undefined {
  let current = dirname(resolve(report));
  for (;;) {
    let isLink = false;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch {
      // Missing (or unreadable): look one level up.
    }
    if (isLink) {
      if (existsSync(current)) return undefined;
      let target = '(unreadable)';
      try {
        target = resolve(dirname(current), readlinkSync(current));
      } catch {
        // Reported as unreadable.
      }
      return (
        `diagnosticsJson '${report}' needs the directory '${current}', a symbolic link to '${target}', which does not exist: ` +
        'create that directory, remove the link, or write the report somewhere else'
      );
    }
    if (existsSync(current)) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Write the JSON report: `{ version, strict, diagnostics }`, one object per
 * diagnostic with its code, severity, page, file, line, column, message, why,
 * fix and (BUILD-403) chain. The path is outside `outputDir` (validation
 * refuses one inside), so the staging swap never touches it.
 *
 * FORMA-245: the report is written to a new file beside the path and renamed
 * over it, so an existing file is replaced, never written through. A report
 * path outside `outputDir` can share an inode with a served file inside it (a
 * hard link); writing through it would rewrite that file with the JSON, and a
 * failing strict build must leave the previous build untouched (L-21). The
 * alternative, refusing a report path whose inode matches a file under
 * `outputDir`, needs a walk of a directory the build is about to replace, can
 * miss a link made after the check, and rejects a report path that is only
 * stale; renaming is safe whatever the path is. A report path that is a symbolic
 * link to a file is followed first (as `isInsideOutputDir` follows it), so the
 * link stays a link and its target is replaced; a link to nothing is replaced
 * by the report. An existing report keeps its permission bits.
 * Verified by: packages/build/tests/strict.test.ts > "replaces a hard-linked report path instead of writing through it: the file inside outputDir keeps its bytes"
 */
export function writeDiagnosticsJson(path: string, strict: boolean, diagnostics: BuildDiagnostic[]): string {
  const target = resolve(path);
  const dangling = danglingReportParent(target);
  if (dangling) throw new Error(`@getforma/build: ${dangling}`);
  mkdirSync(dirname(target), { recursive: true });

  let destination = target;
  try {
    destination = realpathSync(target);
  } catch {
    // Does not exist yet, or a link to nothing: the path itself is replaced.
  }
  let mode: number | undefined;
  try {
    mode = statSync(destination).mode & 0o777;
  } catch {
    // New file: the default mode.
  }

  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ version: DIAGNOSTICS_JSON_VERSION, strict, diagnostics }, null, 2) + '\n', { flag: 'wx' });
    if (mode !== undefined) {
      try {
        chmodSync(temporary, mode);
      } catch {
        // A filesystem without permission bits keeps what it has.
      }
    }
    renameSync(temporary, destination);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Never created, or already moved.
    }
    throw error;
  }
  return target;
}

/** One diagnostic as `file:line:column  CODE  message`, then why and fix. */
export function formatBuildDiagnostic(d: BuildDiagnostic): string {
  const where = d.file ? (d.line > 0 ? `${d.file}:${d.line}:${d.column}` : d.file) : `(page ${d.page || 'none'})`;
  return `${where}  ${d.code}  ${d.message}\n    why: ${d.why}\n    fix: ${d.fix}`;
}

/** The aggregate publication refusal: every error, then the catalogue. */
export function strictFailure(errors: BuildDiagnostic[]): Error & { diagnostics: BuildDiagnostic[] } {
  const count = errors.length === 1 ? '1 SSR diagnostic is an error' : `${errors.length} SSR diagnostics are errors`;
  const error = new Error(
    `@getforma/build: ${count}; 3.0 requires the published server-renderable subset:\n`
    + errors.map(formatBuildDiagnostic).join('\n')
    + `\nEach code, with its fix: ${CATALOGUE_URL}`,
  ) as Error & { diagnostics: BuildDiagnostic[] };
  error.name = 'FormaStrictBuildError';
  error.diagnostics = errors;
  return error;
}
