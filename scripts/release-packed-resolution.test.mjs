import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { linkPackedPackages, assertPackedResolution, internalSpecifiers, INTERNAL_SPECIFIER } from './release-packed-resolution.mjs';

// A checkout as the tag's verify job sees it: the locked graph installed, so the root
// node_modules holds the workspace links, and packages/* never built (no dist).
function checkout({ workspaceBuilt = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma-p17-resolution-')));
  for (const name of ['compiler', 'core']) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify({ name: `@getforma/${name}`, version: '3.0.0-dev', type: 'module', exports: { '.': { import: './dist/index.js' } } }));
    if (workspaceBuilt) { mkdirSync(join(root, 'packages', name, 'dist')); writeFileSync(join(root, 'packages', name, 'dist/index.js'), `export const origin = 'workspace ${name}';\n`); }
    mkdirSync(join(root, 'node_modules/@getforma'), { recursive: true });
    symlinkSync(join(root, 'packages', name), join(root, 'node_modules/@getforma', name), 'dir');
  }
  return root;
}
// The packed set unpacked into the scratch, as P17 lays it out.
function scratchWith(root, { withCore = false, buildImports = ['@getforma/compiler'] } = {}) {
  const scratch = join(root, '.release-verify-test');
  const packed = (name, body) => {
    mkdirSync(join(scratch, 'packages', name, 'dist'), { recursive: true });
    writeFileSync(join(scratch, 'packages', name, 'package.json'), JSON.stringify({ name: `@getforma/${name}`, version: '3.0.0-alpha.2', type: 'module', exports: { '.': { import: './dist/index.js' } } }));
    writeFileSync(join(scratch, 'packages', name, 'dist/index.js'), body);
  };
  packed('compiler', "export const origin = 'packed compiler';\n");
  if (withCore) packed('core', "export const origin = 'packed core';\n");
  packed('build', buildImports.map((s, i) => `export const dep${i} = await import(${JSON.stringify(s)});\n`).join('') + `export const resolved = import.meta.resolve('@getforma/compiler');\n`);
  const packages = [
    { registry: 'npm', name: '@getforma/build', path: 'packages/build' },
    { registry: 'npm', name: '@getforma/compiler', path: 'packages/compiler' },
    ...(withCore ? [{ registry: 'npm', name: '@getforma/core', path: 'packages/core' }] : []),
    { registry: 'npm', name: '@getforma/create-app', path: 'cli' },
    { registry: 'crates', name: 'forma-ir', path: 'crates/forma-ir' },
  ];
  return { scratch, packages, buildDist: join(scratch, 'packages/build/dist/index.js') };
}

test('without the harness links, the packed build resolves its compiler peer through the unbuilt workspace and fails as the tag did', async () => {
  const root = checkout();
  try {
    const { scratch, packages, buildDist } = scratchWith(root);
    assert.throws(() => assertPackedResolution(scratch, packages), /@getforma\/compiler imported from packages\/build\/dist\/index\.js resolves outside the packed set, to .*node_modules\/@getforma\/compiler/);
    await assert.rejects(import(pathToFileURL(buildDist).href), error => error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(join(root, 'node_modules/@getforma/compiler/dist/index.js')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('with the links, every internal specifier resolves inside the packed set and the packed bytes load, workspace built or not', async () => {
  for (const workspaceBuilt of [false, true]) {
    const root = checkout({ workspaceBuilt });
    try {
      const { scratch, packages, buildDist } = scratchWith(root);
      const linked = linkPackedPackages(scratch, packages);
      assert.deepEqual(linked.map(l => l.name).sort(), ['@getforma/build', '@getforma/compiler'], 'the CLI and the crates are not linked');
      const edges = assertPackedResolution(scratch, packages);
      assert.deepEqual(edges, [{ package: '@getforma/build', from: 'packages/build/dist/index.js', specifier: '@getforma/compiler', resolved: 'packages/compiler/dist/index.js' }]);
      const build = await import(pathToFileURL(buildDist).href);
      assert.equal(build.dep0.origin, 'packed compiler', `workspace built: ${workspaceBuilt}`);
      assert(build.resolved.startsWith(pathToFileURL(scratch).href), 'the packed dist itself resolves the peer into the scratch');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('a built workspace never stands in for the packed bytes: a missing link is refused, not silently substituted', () => {
  const root = checkout({ workspaceBuilt: true });
  try {
    const { scratch, packages } = scratchWith(root);
    assert.throws(() => assertPackedResolution(scratch, packages), /resolves outside the packed set/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an internal specifier the packed set does not provide is refused even when the workspace could serve it', () => {
  const root = checkout({ workspaceBuilt: true });
  try {
    // build imports core, but core is not in this (partial) set: the workspace's core must not answer.
    const { scratch, packages } = scratchWith(root, { buildImports: ['@getforma/compiler', '@getforma/core'] });
    linkPackedPackages(scratch, packages);
    assert.throws(() => assertPackedResolution(scratch, packages), /@getforma\/core imported from packages\/build\/dist\/index\.js resolves outside the packed set/);
    const full = scratchWith(root, { withCore: true, buildImports: ['@getforma/compiler', '@getforma/core'] });
    rmSync(join(full.scratch, 'node_modules'), { recursive: true, force: true });
    linkPackedPackages(full.scratch, full.packages);
    assert.equal(assertPackedResolution(full.scratch, full.packages).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the specifier scan sees static, dynamic and require forms with subpaths, and ignores policy-name strings', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma-p17-scan-')));
  try {
    mkdirSync(join(root, 'dist/nested'), { recursive: true });
    writeFileSync(join(root, 'dist/index.js'), `import { h } from "@getforma/core";\nconst c = await import('@getforma/compiler');\nconst policy = "@getforma/core#trusted-types";\n`);
    writeFileSync(join(root, 'dist/nested/cli.cjs'), `const core = require("@getforma/core/runtime");\nimport("@getforma/build")\n`);
    writeFileSync(join(root, 'dist/types.d.ts'), `import type { X } from "@getforma/core";\n`);
    const found = internalSpecifiers(join(root, 'dist')).map(f => f.specifier).sort();
    assert.deepEqual(found, ['@getforma/build', '@getforma/compiler', '@getforma/core', '@getforma/core/runtime']);
    assert.equal([...'x("@getforma/core#trusted-types")'.matchAll(INTERNAL_SPECIFIER)].length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
