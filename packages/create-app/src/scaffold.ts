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
 * maintainer's disk instead of resolving the ranges in the template's
 * package.json, and a lockfile does the same thing more quietly: npm honours
 * it over those ranges, so a template lockfile committed once pins every app
 * scaffolded afterwards to the versions that resolved the day it was authored.
 * That is not hypothetical — a March lockfile in the dashboard template held
 * new projects on @getforma/core 1.0.6 and a compiler that could not find
 * mount(), which is why the templates ship no lockfile at all.
 * Verified by: tests/scaffold-lib.test.ts > "never copies a lockfile or a build directory out of a template"
 */
export const NEVER_COPY = new Set([
  'node_modules',
  'dist',
  'target',
  '.git',
  'package-lock.json',
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

const TEXT_EXTS = new Set(['.toml', '.rs', '.ts', '.tsx', '.json', '.md', '.css', '.html', '.yml']);

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
