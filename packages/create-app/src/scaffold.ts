/**
 * The side-effect-free half of the scaffolder.
 *
 * `index.ts` runs `main()` as soon as it is imported, because it is a CLI
 * entry point. Everything a test would want to reach lives here instead, so
 * importing it cannot start a prompt inside a test runner.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const TEMPLATES = ['dashboard', 'minimal'];

/**
 * What the CLI tells a user each template is, in the picker and in `--help`.
 * Both read this map, so there is one copy of the claim.
 *
 * These strings are documentation, and a user picks a template from them, so
 * every feature named here has to be one the template actually has. The
 * dashboard was advertised as "Live dashboard with islands" while neither
 * template calls `activateIslands` — it is a client-mounted app.
 *
 * Verified by: tests/templates.test.ts > "advertises only features the template actually has"
 */
export const TEMPLATE_INFO: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: 'dashboard',
    description: 'Client-rendered admin panel — 4 pages, 8 JSON API routes, SVG chart, dark theme',
  },
  minimal: {
    title: 'minimal',
    description: 'Clean slate — Rust server + a single JSX page, with Phase 2 SSR wired up',
  },
};

/**
 * Names that must never be copied out of a template, even if a developer left
 * them behind by building a template in place. Copying `node_modules` into a
 * scaffolded project would ship whatever versions happened to be on the
 * maintainer's disk, and build output would ship whatever that disk built.
 *
 * Lockfiles are NOT in this set. Each template ships `admin/package-lock.json`
 * and `Cargo.lock`, the set the scaffold gate installs with `npm ci` and
 * `cargo --locked`, so a new project gets the versions this repo tested rather
 * than whatever resolves on the day (decision DR-32). The risk that once kept
 * them out, a stale lockfile (a March one held new projects on
 * @getforma/core 1.0.6), is closed by tests instead: a lockfile that disagrees
 * with its manifest fails `npm test`, and one that cannot install or build
 * fails the scaffold gate.
 * Verified by: tests/scaffold-lib.test.ts > "copies a template's lockfiles, never its installed dependencies or build output"
 * Verified by: tests/templates.test.ts > "ships an npm lockfile that agrees with package.json and resolves only from the npm registry"
 */
export const NEVER_COPY = new Set([
  'node_modules',
  'dist',
  'target',
  '.git',
]);

/**
 * Names that are safe as (a) a directory name on every platform, (b) a Cargo
 * package name, and (c) an npm-ish identifier. Anything with a path separator,
 * a drive letter, a leading dot or an upper-case letter is rejected, which is
 * also what keeps `path.resolve(projectName)` inside the working directory.
 */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Windows refuses to create a directory with any of these names. */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** Returns null when `name` is usable, otherwise the reason it is not. */
export function validateProjectName(name: string): string | null {
  if (!name) return 'Project name required.';
  if (name.length > 64) return 'Project name must be 64 characters or fewer.';
  if (!NAME_RE.test(name)) {
    return 'Project name must be lowercase alphanumeric with hyphens/underscores, starting with a letter or digit.';
  }
  if (WINDOWS_RESERVED.has(name)) {
    return `"${name}" is a reserved device name on Windows — pick another.`;
  }
  return null;
}

// `.lock` because a template's Cargo.lock names the crate by its placeholder.
const TEXT_EXTS = new Set(['.toml', '.lock', '.rs', '.ts', '.tsx', '.json', '.md', '.css', '.html', '.yml']);

export function replacePlaceholders(dir: string, replacements: Record<string, string>) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    // Symlinks are neither followed nor rewritten: `isDirectory()` and
    // `isFile()` are both false for one, so a link planted in a template
    // cannot make this walk write outside `dir`.
    // Verified by: tests/scaffold-lib.test.ts > "does not write through a symlink that points outside the tree"
    // Verified by: tests/scaffold-lib.test.ts > "does not descend through a symlinked directory"
    if (entry.isDirectory()) {
      replacePlaceholders(fullPath, replacements);
    } else if (entry.isFile() && TEXT_EXTS.has(path.extname(entry.name))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      let next = content;
      for (const [placeholder, value] of Object.entries(replacements)) {
        next = next.replaceAll(placeholder, value);
      }
      if (next !== content) fs.writeFileSync(fullPath, next);
    }
  }
}

/**
 * Rename every `_gitignore` under `dir` to `.gitignore`. Templates store the
 * file under the underscore name because `npm pack` renames a real
 * `.gitignore` to `.npmignore`, which would both lose the file and change
 * what the published tarball contains.
 *
 * Verified by: tests/scaffold-lib.test.ts > "renames _gitignore at every depth"
 */
export function restoreGitignores(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      restoreGitignores(fullPath);
    } else if (entry.isFile() && entry.name === '_gitignore') {
      fs.renameSync(fullPath, path.join(dir, '.gitignore'));
    }
  }
}

/**
 * Make a scaffolded Cargo.lock read exactly as cargo would write it once the
 * project's own `[[package]]` entry carries the project's name.
 *
 * A template's Cargo.lock names the crate by its placeholder, and
 * `replacePlaceholders` rewrites that to the project name. Two things cargo
 * derives from the name then go stale:
 *
 * - the entry's place: cargo orders entries by name compared bytewise, then
 *   version, and at an equal name and version a path package (the project)
 *   comes before a registry one;
 * - references to a registry crate that shares the project's name: cargo
 *   writes a dependency as `"name"` while one package has that name,
 *   `"name version"` while one has that name and version, and
 *   `"name version (source)"` otherwise, so naming a project `tracing` turns
 *   every `"tracing"` in the file into `"tracing 0.1.44"`.
 *
 * Left stale, `cargo --locked` refuses the file when a name collides, and a
 * plain `cargo run` rewrites it either way, so the project would start with a
 * modified Cargo.lock before its author had changed anything. Every other
 * line and the file's line endings are left exactly as they were.
 *
 * Verified by: tests/scaffold-lib.test.ts > "moves the renamed entry to where cargo sorts it and changes nothing else"
 * Verified by: tests/scaffold-lib.test.ts > "matches cargo's own lockfile for a project named %s, a crate in its graph, and is then a no-op"
 * Verified by: tests/scaffold-lib.test.ts > "matches cargo's own lockfile when the project ties a locked crate's name and version"
 * Verified by: tests/scaffold.test.ts > "puts the project's own Cargo.lock entry where cargo sorts it"
 * Verified by: tests/scaffold.test.ts > "%s scaffolded as %s, a crate in its own graph: cargo --locked accepts the lockfile and plain cargo leaves it"
 */
export function placeCargoLockRoot(lockPath: string, crateName: string) {
  if (!fs.existsSync(lockPath)) return;
  const text = fs.readFileSync(lockPath, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // Cargo ends the file with a newline, which leaves a final '' here. Supply
  // one if it is missing, so that every block below ends with its blank line.
  const finalNewline = lines[lines.length - 1] === '';
  if (!finalNewline) lines.push('');

  const starts = lines.flatMap((line, i) => (line === '[[package]]' ? [i] : []));
  if (starts.length === 0) return;
  // Each block runs from its `[[package]]` line to the next one, so it carries
  // its own trailing blank line and moving it keeps the layout.
  const head = lines.slice(0, starts[0]);
  const blocks = starts.map((start, k) => lines.slice(start, starts[k + 1] ?? lines.length));
  const field = (block: string[], key: string) =>
    block.find((l) => l.startsWith(`${key} = "`))?.slice(key.length + 4, -1) ?? '';

  // The root is the entry with the crate's name and no `source`; a registry
  // crate that happens to share the name always has one.
  const rootIdx = blocks.findIndex(
    (b) => field(b, 'name') === crateName && !b.some((l) => l.startsWith('source = ')),
  );
  if (rootIdx === -1) return;
  const root = blocks.splice(rootIdx, 1)[0]!;
  const rootVersion = field(root, 'version');

  // At an equal name and version, the project (a path package) sorts first.
  const sortsAfterRoot = (b: string[]) => {
    const name = field(b, 'name');
    if (name !== crateName) return name > crateName;
    return compareVersions(field(b, 'version'), rootVersion) >= 0;
  };
  const at = blocks.findIndex(sortsAfterRoot);
  blocks.splice(at === -1 ? blocks.length : at, 0, root);

  // Rewrite each reference to a registry namesake from the form it had
  // without the project to the form it needs with it.
  const registry = blocks.filter((b) => b !== root && field(b, 'name') === crateName);
  const reference = (b: string[], among: string[][]) => {
    const version = field(b, 'version');
    if (among.filter((o) => field(o, 'version') === version).length > 1) {
      return `${crateName} ${version} (${field(b, 'source')})`;
    }
    return new Set(among.map((o) => field(o, 'version'))).size > 1 ? `${crateName} ${version}` : crateName;
  };
  const rewrites = new Map(
    registry.map((b) => [` "${reference(b, registry)}",`, ` "${reference(b, [...registry, root])}",`]),
  );
  const body = blocks.flat().map((line) => rewrites.get(line) ?? line);

  let next = [...head, ...body].join(eol);
  if (!finalNewline) next = next.slice(0, -eol.length);
  if (next !== text) fs.writeFileSync(lockPath, next);
}

/** Compares dotted numeric versions such as `0.1.0`: enough for a crate's own version. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(Number);
  const pb = b.split(/[.+-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
