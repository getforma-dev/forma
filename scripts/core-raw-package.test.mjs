// Compile against an actually packed, isolated install, including its copied JSX
// declaration. skipLibCheck:false detects broken declaration imports/index types.
// FORMA-174: the one packed install is type-checked under every consumer
// resolution mode (NodeNext, bundler, node16, node10) as its own reported test.
// These are TypeScript moduleResolution modes, not Node runtime versions.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
function compile(mode, file, extra = []) {
  save(join(app, 'tsconfig.json'), { compilerOptions: { target: 'ES2022', module: mode.module, moduleResolution: mode.moduleResolution, jsx: 'react', jsxFactory: 'h', noEmit: true, strict: true, skipLibCheck: false, types: [] }, files: [file] });
  const r = spawnSync(process.execPath, [tsc, '-p', join(app, 'tsconfig.json'), ...extra], { cwd: app, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
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
  writeFileSync(join(app, 'positive.tsx'), positive);
  writeFileSync(join(app, 'negative.tsx'), negative);
  writeFileSync(join(app, 'island-negative.tsx'), islandNegative);
  writeFileSync(join(app, 'cjs-consumer.cts'), cjsConsumer);
  controls.forEach((c, i) => writeFileSync(join(app, `control-${i}.tsx`), c.source));
});
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

for (const mode of modes) {
  test(`packed core declarations enforce raw markup and callable island boundaries in a strict JSX consumer (${mode.name}: module ${mode.module}, moduleResolution ${mode.moduleResolution})`, { timeout: 120_000 }, () => {
    const ok = (file, message) => { const r = compile(mode, file); assert.equal(r.status, 0, `${message}\n${r.output}`); };
    // Prove each mode resolved the packed declarations the way it is supposed to,
    // rather than some other copy: the real file, via typesVersions for node10.
    const trace = compile(mode, 'positive.tsx', ['--traceResolution']).output;
    for (const [specifier, file] of [['@getforma/core', 'dist/index.d.ts'], ['@getforma/core/runtime', 'dist/runtime.d.ts']]) {
      assert.match(trace, new RegExp(`Module name '${specifier}' was successfully resolved to '[^']*node_modules/@getforma/core/${file.replace('.', '\\.')}'`), `${mode.name} must resolve ${specifier} to the packed ${file}`);
    }
    if (mode.typesVersions) assert.match(trace, /'typesVersions' entry '\*' .*pattern to match module name 'runtime'/, 'node10 must reach the subpath through typesVersions, since it cannot read package exports');
    ok('positive.tsx', 'the positive consumer must compile without library errors');
    if (/^node(16|next)$/i.test(mode.moduleResolution)) ok('cjs-consumer.cts', 'the CommonJS consumer must compile against the packed .d.cts declarations');
    ok('negative.tsx', 'all nine plain-string calls must have their own type error');
    ok('island-negative.tsx', 'all five noncallable entries must have their own type error');
    controls.forEach((c, i) => {
      const r = compile(mode, `control-${i}.tsx`);
      assert.notEqual(r.status, 0, `negative control "${c.name}" must fail under ${mode.name}, or a pass proves nothing`);
      assert.match(r.output, new RegExp(`error ${c.code}`), `negative control "${c.name}" must fail with ${c.code} under ${mode.name}\n${r.output}`);
    });
  });
}
