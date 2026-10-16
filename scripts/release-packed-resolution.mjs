// P17 runs the packed npm packages from a scratch directory inside the checkout, so their
// third-party dependencies resolve through the harness's locked graph in the root
// node_modules. That same walk would also find the root's workspace links
// (node_modules/@getforma/* -> packages/*) for any bare "@getforma/*" import a packed dist
// makes, such as build's optional compiler peer. On a tag the verify job never builds
// packages/*, so that resolution fails (v3.0.0-alpha.1, run 38764599499); on a built
// workstation it silently substitutes the workspace build for the packed bytes. Both are
// wrong: the packed packages must resolve one another, and only one another, inside the
// scratch. The harness writes a node_modules beside them and then proves, with Node's own
// ESM resolver, that every internal specifier in every packed dist lands in the scratch.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCOPE = '@getforma';
// Static import, dynamic import or require of a bare "@getforma/<package>[/subpath]".
export const INTERNAL_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)["'](@getforma\/[a-z0-9-]+(?:\/[^"'\s]*)?)["']/gm;

export function packedNpmLibraries(packages) {
  return packages.filter(p => p.registry === 'npm' && p.name.startsWith(`${SCOPE}/`) && p.name !== `${SCOPE}/create-app`);
}

// scratch/node_modules/@getforma/<name> -> scratch/<path>, for every packed library.
export function linkPackedPackages(scratch, packages) {
  const scope = join(scratch, 'node_modules', SCOPE);
  mkdirSync(scope, { recursive: true });
  const linked = [];
  for (const p of packedNpmLibraries(packages)) {
    const target = join(scratch, p.path);
    assert(existsSync(join(target, 'package.json')), `${p.name}: packed package is not unpacked at ${p.path}`);
    const link = join(scope, p.name.slice(SCOPE.length + 1));
    symlinkSync(target, link, 'dir');
    linked.push({ name: p.name, link: relative(scratch, link), target: relative(scratch, target) });
  }
  return linked;
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(?:m?js|cjs)$/.test(entry)) yield path;
  }
}
// Every bare internal specifier a packed dist contains, with the file that contains it.
export function internalSpecifiers(dist) {
  const found = [];
  if (!existsSync(dist)) return found;
  for (const file of files(dist)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(INTERNAL_SPECIFIER)) found.push({ file, specifier: match[1] });
  }
  return found;
}

// Node's real ESM resolution from the file's directory (package.json "exports" included),
// in a child process because import.meta.resolve's parent argument is flag-gated.
export function resolveFrom(file, specifier) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', 'console.log(import.meta.resolve(process.argv[1]))', '--', specifier], { cwd: dirname(file), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim();
}

export function assertPackedResolution(scratch, packages) {
  // Node reports the resolved module's real path; compare against the scratch's real path.
  const real = realpathSync(scratch);
  const inside = pathToFileURL(`${real}/`).href;
  const edges = [];
  for (const p of packedNpmLibraries(packages)) {
    for (const { file, specifier } of internalSpecifiers(join(real, p.path, 'dist'))) {
      const from = relative(real, file);
      let resolved;
      try { resolved = resolveFrom(file, specifier); }
      catch (error) { throw new Error(`${p.name}: ${specifier} imported from ${from} does not resolve inside the packed set: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`); }
      assert(resolved.startsWith(inside), `${p.name}: ${specifier} imported from ${from} resolves outside the packed set, to ${resolved}; the harness must link it, never the workspace`);
      edges.push({ package: p.name, from, specifier, resolved: relative(real, fileURLToPath(resolved)) });
    }
  }
  return edges;
}
