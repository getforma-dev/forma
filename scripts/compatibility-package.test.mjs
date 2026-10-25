// Real packed installations, outside the checkout. No registry writes or lifecycle scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build as bundle } from 'esbuild';
import { ROOT, json, save, run, stageNpmLock, compatibilityPeer } from './release-set.mjs';

const publicNames = [
  'COMPILER_WRITER_VERSION', 'DIAGNOSTIC_CATALOGUE', 'FmirContainerError', 'IrEmitContext',
  'baseWriterVersion', 'collectDiagnostics', 'crc32', 'diagnosticEntry', 'dumpFmir',
  'encodeFmirSections', 'formaClientPlugin', 'formaSsrPlugin', 'formatDiagnostic', 'generateRealIr', 'getSsrEntryProducts', 'makeDiagnostic', 'readFmirContainer', 'transformClientTemplates',
].sort();
function install(dir, members, artifacts) {
  mkdirSync(dir);
  const manifest = { name: 'compatibility-consumer', version: '1.0.0', private: true, type: 'module', dependencies: Object.fromEntries(members.map(p => [p.name, `=${p.version}`])) };
  const lock = { lockfileVersion: 3, requires: true, packages: { '': manifest, ...Object.fromEntries(members.map(p => [`node_modules/${p.name}`, { version: p.version }])) } };
  const shipped = stageNpmLock(manifest, lock, members, artifacts, false, json(join(ROOT, 'package-lock.json')));
  const local = stageNpmLock(shipped.manifest, shipped.lock, members, artifacts, true);
  save(join(dir, 'package.json'), local.manifest); save(join(dir, 'package-lock.json'), local.lock);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--strict-peer-deps'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
function pack(dir, artifacts) {
  const metadata = json(join(dir, 'package.json'));
  const result = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts], dir, { stdio: 'pipe' }));
  return { registry: 'npm', name: metadata.name, version: metadata.version, file: result[0].filename };
}
function execute(dir, source) {
  return run(process.execPath, ['--input-type=module', '-e', source], dir, { stdio: 'pipe', env: { ...process.env, NODE_PATH: '' } });
}

test('the actual packed compiler exposes documented runtime and declaration entries only', { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'forma-packed-api-'));
  try {
    const members = ['core', 'compiler'].map(name => pack(join(ROOT, 'packages', name), root));
    const app = join(root, 'consumer'); install(app, members, root);
    const actual = JSON.parse(execute(app, 'import * as compiler from "@getforma/compiler"; console.log(JSON.stringify(Object.keys(compiler).sort()));'));
    assert.deepEqual(actual, publicNames);
    // Both installed module systems expose the lazy compiler entry without
    // touching browser globals or evaluating its markup at module creation.
    assert.equal(execute(app, 'import {createRequire} from "node:module"; import {__createCompiledTemplate as esm} from "@getforma/core/compiled"; const {__createCompiledTemplate:cjs}=createRequire(import.meta.url)("@getforma/core/compiled"); for(const make of [esm,cjs]) { if(typeof make(()=>{throw new Error("eager markup")},[])!=="function") throw new Error("invalid compiled factory"); } console.log("lazy");').trim(), 'lazy');
    // Use the actually installed main/compiled pair in both module systems.
    // A source-only bundle could hide a duplicated owner graph in packaging.
    assert.equal(execute(app, `
      import assert from 'node:assert/strict';
      import {createRequire} from 'node:module';
      import {Window} from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/happy-dom/lib/index.js')).href)};
      const window = new Window(); globalThis.document = window.document;
      for (const name of ['Node','Text','Comment','Element','HTMLElement','HTMLTextAreaElement','HTMLInputElement','HTMLSelectElement','SVGElement','DocumentFragment']) globalThis[name] = window[name];
      const require = createRequire(import.meta.url);
      for (const [core, compiled] of [
        [await import('@getforma/core'), await import('@getforma/core/compiled')],
        [require('@getforma/core'), require('@getforma/core/compiled')],
      ]) {
        let stop, stopLive, reads = 0, calls = 0;
        const [value, setValue] = core.createSignal('initial');
        const row = compiled.__createCompiledTemplate(() => core.trustedHtml('<div><span></span><button>go</button></div>'), [[[0],1],[[1],2,'onClick']]);
        const initialize = bind => { bind(0, () => { reads++; return value(); }); bind(1, () => calls++); };
        const stale = core.createRoot(dispose => { stop = dispose; return row(initialize); });
        document.body.append(stale); stale.querySelector('button').click();
        assert.equal(calls,1); assert.equal(stale.querySelector('span').textContent,'initial');
        stop(); stale.remove(); const before = reads; setValue('after disposal'); assert.equal(reads,before);
        const live = core.createRoot(dispose => { stopLive = dispose; return row(initialize); });
        document.body.append(live, stale); stale.querySelector('button').click(); assert.equal(calls,1);
        live.querySelector('button').click(); assert.equal(calls,2);
        stopLive(); document.body.replaceChildren();
      }
      console.log('shared owners');
    `).trim(), 'shared owners');
    for (const path of ['@getforma/compiler/src/ir-walk', '@getforma/compiler/dist/ir-resolve.js', '@getforma/compiler/package.json']) {
      assert.throws(() => execute(app, `await import(${JSON.stringify(path)});`), error => /ERR_PACKAGE_PATH_NOT_EXPORTED/.test(String(error.stderr)));
    }
    const privateNames = ['ComponentAnalyzer', 'walkHTree', 'walkCallExpression', 'resolveImports', 'loadModule', 'classifyComponent', 'collectIslandEntryEdits', 'isCoreCall', 'EntryPolicyError', 'formaCompiler', 'formaServer'];
    writeFileSync(join(app, 'surface.mts'), [
      'import { formaSsrPlugin, generateRealIr, getSsrEntryProducts, IrEmitContext, readFmirContainer, dumpFmir, type SsrEntryProduct, type PropsSchema, type Diagnostic } from "@getforma/compiler";',
      'const products: readonly SsrEntryProduct[] = getSsrEntryProducts({errors: [], warnings: []});',
      '// @ts-expect-error compiler products and nested definition lists are immutable',
      'products[0]!.islands.push({name: "forged", mode: "ssr"});',
      'const schema: PropsSchema = [[]]; const ctx = new IrEmitContext(); ctx.setPropsSchema(schema); dumpFmir(ctx.toBinary());',
      'import {h, trustedHtml} from "@getforma/core";',
      'import {__createCompiledTemplate} from "@getforma/core/compiled";',
      'const row = __createCompiledTemplate(() => trustedHtml("<div></div>"), []); row(bind => { if (!bind) return h("div", null); });',
      ...privateNames.flatMap(name => ['// @ts-expect-error internal or removed API is not published', `import { ${name} } from "@getforma/compiler";`]),
    ].join('\n'));
    save(join(app, 'tsconfig.json'), { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true, strict: true, skipLibCheck: true, types: [] }, files: ['surface.mts'] });
    run(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(app, 'tsconfig.json')], app, { stdio: 'pipe' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a real versioned packed build refuses npm optional-compiler skew before writes and permits browser absence', { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'forma-packed-window-'));
  async function versioned(member, version) {
    const dir = join(root, `${member}-${version}`); mkdirSync(dir);
    const manifest = json(join(ROOT, `packages/${member}/package.json`)); manifest.version = version;
    if (member !== 'core') {
      const peer = member === 'compiler' ? '@getforma/core' : '@getforma/compiler';
      manifest.peerDependencies[peer] = compatibilityPeer(version);
    }
    save(join(dir, 'package.json'), manifest);
    if (member === 'core') cpSync(join(ROOT, 'packages/core/dist'), join(dir, 'dist'), { recursive: true });
    else {
      const metadataPath = resolve(ROOT, `packages/${member}/package.json`);
      await bundle({ entryPoints: [join(ROOT, `packages/${member}/src/index.ts`)], outfile: join(dir, 'dist/index.js'), bundle: true, format: 'esm', platform: 'node', target: 'node18', packages: 'external', plugins: [{ name: 'controlled-package-version', setup(build) { build.onLoad({ filter: /package\.json$/ }, args => args.path === metadataPath ? { contents: JSON.stringify(manifest), loader: 'json' } : undefined); } }] });
    }
    return pack(dir, root);
  }
  try {
    // Production source, compiled under controlled package versions; no source edits.
    const core = await versioned('core', '3.2.0');
    const older = await versioned('compiler', '3.1.0');
    const equal = await versioned('compiler', '3.2.0');
    const build = await versioned('build', '3.2.0');
    for (const [name, compiler, refused] of [['older', older, true], ['equal', equal, false], ['absent', null, false]]) {
      const app = join(root, name);
      const result = install(app, [core, build, ...(compiler ? [compiler] : [])], root);
      // npm ci can accept this pre-recorded optional conflict silently; the
      // separate npm install matrix records its warning behavior. Verify the
      // installed versions, then require production build() to refuse it.
      assert.equal(json(join(app, 'node_modules/@getforma/build/package.json')).version, '3.2.0');
      if (compiler) assert.equal(json(join(app, 'node_modules/@getforma/compiler/package.json')).version, compiler.version);
      writeFileSync(join(app, 'app.ts'), 'export const value = "packed production build";');
      mkdirSync(join(app, 'dist')); writeFileSync(join(app, 'dist/sentinel'), 'last valid output');
      const source = 'import {build} from "@getforma/build"; await build({app:"window",entryPoints:[{entry:"app.ts",outfile:"app.js"}],routes:{"/":{js:["app"],css:[]}},outputDir:"dist"});';
      if (refused) {
        assert.throws(() => execute(app, source), error => /BUILD-809 @getforma\/build 3\.2\.0.*installed compiler is 3\.1\.0/.test(String(error.stderr)));
        assert.equal(readFileSync(join(app, 'dist/sentinel'), 'utf8'), 'last valid output');
        assert(!readdirSync(app).some(name => name.includes('forma-staging')));
      } else {
        execute(app, source);
        assert.equal(json(join(app, 'dist/manifest.json')).writer, '3.2.0');
        assert(!existsSync(join(app, 'dist/sentinel')));
        if (!compiler) assert(!existsSync(join(app, 'node_modules/@getforma/compiler')));
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
