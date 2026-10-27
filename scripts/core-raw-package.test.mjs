// Compile against an actually packed, isolated install, including its copied JSX
// declaration. skipLibCheck:false detects broken declaration imports/index types.
// FORMA-174: the one packed install is type-checked under every consumer
// resolution mode (NodeNext, bundler, node16, node10) as its own reported test.
// These are TypeScript moduleResolution modes, not Node runtime versions.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { ROOT, json, save, run, stageNpmLock } from './release-set.mjs';

const imports = 'import { h, trustedHtml, setHTMLUnsafe, setAttr, template, templateMany, activateIslands, browserOnly, createSignal, type IslandHydrateFn } from "@getforma/core";\nimport { mountMarkup } from "@getforma/core/runtime";\nconst html = trustedHtml("<p>reviewed</p>"); const el = document.createElement("div");\n';
const positive = imports + [
  'h("div", { dangerouslySetInnerHTML: { __html: html } });',
  'h("div", { dangerouslySetInnerHTML: () => false });',
  'h("iframe", { srcdoc: html }); setAttr(el, { srcdoc: html });',
  'setHTMLUnsafe(el, html); template(html); templateMany(html);',
  'const frame = <iframe srcdoc={html} data-forma-island={undefined} />;',
  'const content = <div dangerouslySetInnerHTML={{ __html: html }} />;',
  'mountMarkup(el, html, { tier: "reviewed" });',
  'function Counter(props: { initial: number }) { const [count] = createSignal(props.initial); return <span>{() => count()}</span>; }',
  'const Chart = browserOnly((props: { title: string }) => <canvas aria-label={props.title} />);',
  // Existing callable declarations remain assignable. Runtime preflight
  // still requires compiler metadata; a type does not mint that brand.
  'const inherited: IslandHydrateFn = (element, props) => { element.dataset.value = String(props?.value ?? ""); };',
  'activateIslands({ Counter, Chart, inherited });',
].join('\n');
const negativeLines = [
  'h("div", { dangerouslySetInnerHTML: { __html: "raw" } });',
  'h("iframe", { srcdoc: "raw" });',
  'setHTMLUnsafe(el, "raw");',
  'setAttr(el, { srcdoc: "raw" });',
  'template("raw");', 'templateMany("raw");',
  'const frame = <iframe srcdoc="raw" />;',
  'const content = <div dangerouslySetInnerHTML={{ __html: "raw" }} />;',
  'mountMarkup(el, "raw", { tier: "reviewed" });',
];
const negative = imports + negativeLines.map(line => '// @ts-expect-error plain strings are outside the published raw boundary\n' + line).join('\n');
const noncallable = ['42', 'null', 'undefined', '"Counter"', '{ render: Counter }'];
const islandNegative = imports +
  'function Counter(props: { initial: number }) { return h("span", null, props.initial); }\n' +
  noncallable.map(value => '// @ts-expect-error a registry entry must be callable\nactivateIslands({ Bad: ' + value + ' });').join('\n');
// Deliberately wrong consumers WITHOUT @ts-expect-error. Each must fail with the
// named diagnostic, so a mode that resolves nothing or checks nothing cannot pass.
const controls = [
  { name: 'missing value export', code: 'TS2305', source: imports.replace('createSignal,', 'createSignal, notAForma174Export,') },
  { name: 'missing subpath export', code: 'TS2305', source: imports.replace('{ mountMarkup }', '{ notAForma174Export }') },
  { name: 'plain string to raw boundary', code: 'TS2', source: imports + negativeLines[0] },
  { name: 'noncallable island entry', code: 'TS2', source: imports + 'activateIslands({ Bad: 42 });' },
  { name: 'unresolvable package', code: 'TS2307', source: 'import { h } from "@getforma/not-a-package"; h("div", null);' },
];

// All options keep strict:true and skipLibCheck:false. module/moduleResolution
// pairs are the valid combinations TypeScript accepts for each mode.
const modes = [
  { name: 'NodeNext', module: 'NodeNext', moduleResolution: 'NodeNext' },
  { name: 'bundler', module: 'ESNext', moduleResolution: 'Bundler' },
  { name: 'node16', module: 'Node16', moduleResolution: 'Node16' },
  // node10 cannot read package.json "exports"; it resolves "@getforma/core" via
  // "types"/"main" and "@getforma/core/runtime" via "typesVersions".
  { name: 'node10', module: 'CommonJS', moduleResolution: 'Node10', typesVersions: true },
];
// A CommonJS-format consumer (.cts) makes node16/NodeNext take the "require"
// condition and so type-check the published dist/*.d.cts files as well.
const cjsConsumer = 'import { h, trustedHtml, activateIslands } from "@getforma/core";\nimport { mountMarkup } from "@getforma/core/runtime";\nconst el = document.createElement("div"); const html = trustedHtml("<p>reviewed</p>");\n' +
  'h("div", { dangerouslySetInnerHTML: { __html: html } }); mountMarkup(el, html, { tier: "reviewed" }); activateIslands({ Counter: (props: { initial: number }) => props.initial });\n' +
  '// @ts-expect-error plain strings are outside the published raw boundary\nh("div", { dangerouslySetInnerHTML: { __html: "raw" } });\n' +
  '// @ts-expect-error a registry entry must be callable\nactivateIslands({ Bad: 42 });\n';

let root; let app;
const tsc = join(ROOT, 'node_modules/typescript/bin/tsc');
function compile(mode, files, extra = []) {
  save(join(app, 'tsconfig.json'), { compilerOptions: { target: 'ES2022', module: mode.module, moduleResolution: mode.moduleResolution, jsx: 'react', jsxFactory: 'h', noEmit: true, strict: true, skipLibCheck: false, types: [] }, files });
  const r = spawnSync(process.execPath, [tsc, '-p', join(app, 'tsconfig.json'), '--pretty', 'false', ...extra], { cwd: app, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
  assert.equal(r.error, undefined, `the compiler must start successfully: ${r.error}`);
  assert.equal(r.signal, null, `the compiler must finish without a signal: ${r.signal}`);
  assert.equal(r.stderr, '', `unexpected compiler stderr: ${r.stderr}`);
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

// Grouping shares declaration parsing, not fixture scope. Refuse fixtures that
// could supply globals, augment a package or import another consumer's bindings.
function isolatedFixture(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length, 0, `${file} must be syntactically valid`);
  assert(ts.isExternalModule(parsed), `${file} must have its own module scope`);
  for (const references of [parsed.referencedFiles, parsed.typeReferenceDirectives, parsed.libReferenceDirectives]) {
    assert.equal(references.length, 0, `${file} must not add reference directives`);
  }
  const imports = new Set(['@getforma/core', '@getforma/core/runtime', '@getforma/not-a-package']);
  const visit = node => {
    assert(!ts.isModuleDeclaration(node), `${file} must not declare globals, namespaces or module augmentations`);
    assert(!ts.isImportEqualsDeclaration(node) && !ts.isImportTypeNode(node), `${file} must use only its declared package imports`);
    assert(!(ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword), `${file} must not add dynamic imports`);
    assert(!(ts.isExportDeclaration(node) && node.moduleSpecifier), `${file} must not re-export another module`);
    if (ts.isImportDeclaration(node)) assert(ts.isStringLiteral(node.moduleSpecifier) && imports.has(node.moduleSpecifier.text), `${file} must not import another consumer`);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  writeFileSync(join(app, file), source);
}

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function resolvedFrom(trace, consumer, specifier, declaration) {
  const name = escapePattern(specifier);
  const pattern = new RegExp(`^======== Resolving module '${name}' from '([^']+)'\\. ========\\r?\\n([\\s\\S]*?)^======== Module name '${name}' ([^\\r\\n]*) ========`, 'gm');
  const blocks = [...trace.matchAll(pattern)].filter(match => realpathSync(match[1]) === realpathSync(join(app, consumer)));
  assert.equal(blocks.length, 1, `${specifier} needs one resolution trace from ${consumer}`);
  const target = /was successfully resolved to '([^']+)'/.exec(blocks[0][3]);
  assert(target, `${consumer} must resolve ${specifier} successfully`);
  assert.equal(realpathSync(target[1]), realpathSync(join(app, 'node_modules/@getforma/core', declaration)), `${consumer} must resolve the packed ${declaration}`);
  return blocks[0][2];
}

function negativeDiagnostics(output) {
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/.exec(line);
    if (match) diagnostics.push({ file: realpathSync(resolve(app, match[1])), code: match[4] });
    else assert(diagnostics.length && /^\s+\S/.test(line) && !/\berror TS\d+:/.test(line), `unexpected compiler output: ${line}`);
  }
  return diagnostics;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'forma-raw-types-'));
  const pkg = json(join(ROOT, 'packages/core/package.json'));
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], join(ROOT, 'packages/core'), { stdio: 'pipe' }));
  const packages = [{ registry: 'npm', name: pkg.name, version: pkg.version, file: packed[0].filename }];
  const manifest = { name: 'raw-types-consumer', version: '1.0.0', private: true, type: 'module', dependencies: { [pkg.name]: `=${pkg.version}` } };
  const lock = { lockfileVersion: 3, requires: true, packages: { '': manifest, [`node_modules/${pkg.name}`]: { version: pkg.version } } };
  const shipped = stageNpmLock(manifest, lock, packages, root, false, json(join(ROOT, 'package-lock.json')));
  const local = stageNpmLock(shipped.manifest, shipped.lock, packages, root, true);
  app = join(root, 'consumer'); mkdirSync(app);
  save(join(app, 'package.json'), local.manifest); save(join(app, 'package-lock.json'), local.lock);
  run('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], app, { stdio: 'pipe' });
  isolatedFixture('positive.tsx', positive);
  isolatedFixture('negative.tsx', negative);
  isolatedFixture('island-negative.tsx', islandNegative);
  isolatedFixture('cjs-consumer.cts', cjsConsumer);
  controls.forEach((c, i) => isolatedFixture(`control-${i}.tsx`, c.source));
});
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

for (const mode of modes) {
  test(`packed core declarations enforce raw markup and callable island boundaries in a strict JSX consumer (${mode.name}: module ${mode.module}, moduleResolution ${mode.moduleResolution})`, { timeout: 120_000 }, () => {
    const commonjs = /^node(16|next)$/i.test(mode.moduleResolution);
    // Prove each mode resolved the packed declarations the way it is supposed to,
    // rather than some other copy: the real file, via typesVersions for node10.
    // Tracing adds resolution diagnostics to the same strict compilation; its
    // exit status must pass before any successful-resolution text is trusted.
    // Every original success/expect-error fixture is still checked. Group only
    // the ESM fixtures: a .cts root must not supply ambient JSX declarations if
    // the ESM entry point ever loses its own reference to the shipped jsx.d.ts.
    const positive = compile(mode, ['positive.tsx', 'negative.tsx', 'island-negative.tsx'], ['--traceResolution']);
    assert.equal(positive.status, 0, `the positive consumer must compile without library errors\n${positive.output}`);
    const trace = positive.output;
    for (const [specifier, file] of [['@getforma/core', 'dist/index.d.ts'], ['@getforma/core/runtime', 'dist/runtime.d.ts']]) {
      const block = resolvedFrom(trace, 'positive.tsx', specifier, file);
      if (mode.typesVersions && specifier === '@getforma/core/runtime') assert.match(block, /'typesVersions' entry '\*' .*pattern to match module name 'runtime'/, 'node10 must reach the subpath through typesVersions, since it cannot read package exports');
    }
    if (commonjs) {
      const cjs = compile(mode, ['cjs-consumer.cts'], ['--traceResolution']);
      assert.equal(cjs.status, 0, `the CommonJS consumer must compile against the packed .d.cts declarations\n${cjs.output}`);
      for (const [specifier, file] of [['@getforma/core', 'dist/index.d.cts'], ['@getforma/core/runtime', 'dist/runtime.d.cts']]) {
        assert.match(resolvedFrom(cjs.output, 'cjs-consumer.cts', specifier, file), /Resolving in CJS mode with conditions .*'require'/, 'the CommonJS consumer must resolve its own require-condition declarations');
      }
    }
    const failed = compile(mode, controls.map((_, i) => `control-${i}.tsx`));
    assert.equal(failed.status, 2, `deliberate type errors must produce the compiler's diagnostic exit under ${mode.name}\n${failed.output}`);
    const diagnostics = negativeDiagnostics(failed.output);
    const paths = controls.map((_, i) => realpathSync(join(app, `control-${i}.tsx`)));
    assert.deepEqual(diagnostics.map(d => d.file).sort(), [...paths].sort(), `every control needs exactly its own diagnostic, with no extra file/config/library errors\n${failed.output}`);
    controls.forEach((c, i) => {
      const diagnostic = diagnostics.find(d => d.file === paths[i]);
      assert.match(diagnostic.code, new RegExp(`^${c.code}${c.code === 'TS2' ? '\\d{3}' : ''}$`), `negative control "${c.name}" must fail with ${c.code} in its own file under ${mode.name}\n${failed.output}`);
    });
  });
}
