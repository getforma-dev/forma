// Compile against an actually packed, isolated install, including its copied JSX
// declaration. skipLibCheck:false detects broken declaration imports/index types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, json, save, run, stageNpmLock } from './release-set.mjs';

test('packed core declarations accept only typed raw markup under a strict external JSX consumer', { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'forma-raw-types-'));
  try {
    const pkg = json(join(ROOT, 'packages/core/package.json'));
    const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], join(ROOT, 'packages/core'), { stdio: 'pipe' }));
    const packages = [{ registry: 'npm', name: pkg.name, version: pkg.version, file: packed[0].filename }];
    const manifest = { name: 'raw-types-consumer', version: '1.0.0', private: true, type: 'module', dependencies: { [pkg.name]: `=${pkg.version}` } };
    const lock = { lockfileVersion: 3, requires: true, packages: { '': manifest, [`node_modules/${pkg.name}`]: { version: pkg.version } } };
    const shipped = stageNpmLock(manifest, lock, packages, root, false, json(join(ROOT, 'package-lock.json')));
    const local = stageNpmLock(shipped.manifest, shipped.lock, packages, root, true);
    const app = join(root, 'consumer'); mkdirSync(app);
    save(join(app, 'package.json'), local.manifest); save(join(app, 'package-lock.json'), local.lock);
    run('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], app, { stdio: 'pipe' });
    const imports = 'import { h, trustedHtml, setHTMLUnsafe, setAttr, template, templateMany } from "@getforma/core";\nimport { mountMarkup } from "@getforma/core/runtime";\nconst html = trustedHtml("<p>reviewed</p>"); const el = document.createElement("div");\n';
    writeFileSync(join(app, 'positive.tsx'), imports + [
      'h("div", { dangerouslySetInnerHTML: { __html: html } });',
      'h("div", { dangerouslySetInnerHTML: () => false });',
      'h("iframe", { srcdoc: html }); setAttr(el, { srcdoc: html });',
      'setHTMLUnsafe(el, html); template(html); templateMany(html);',
      'const frame = <iframe srcdoc={html} data-forma-island={undefined} />;',
      'const content = <div dangerouslySetInnerHTML={{ __html: html }} />;',
      'mountMarkup(el, html, { tier: "reviewed" });',
    ].join('\n'));
    const negative = [
      'h("div", { dangerouslySetInnerHTML: { __html: "raw" } });',
      'h("iframe", { srcdoc: "raw" });',
      'setHTMLUnsafe(el, "raw");',
      'setAttr(el, { srcdoc: "raw" });',
      'template("raw");', 'templateMany("raw");',
      'const frame = <iframe srcdoc="raw" />;',
      'const content = <div dangerouslySetInnerHTML={{ __html: "raw" }} />;',
      'mountMarkup(el, "raw", { tier: "reviewed" });',
    ];
    writeFileSync(join(app, 'negative.tsx'), imports + negative.map(line => '// @ts-expect-error plain strings are outside the published raw boundary\n' + line).join('\n'));
    save(join(app, 'tsconfig.json'), { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'react', jsxFactory: 'h', noEmit: true, strict: true, skipLibCheck: false, types: [] }, files: ['positive.tsx'] });
    const compile = () => run(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(app, 'tsconfig.json')], app, { stdio: 'pipe', env: { ...process.env, NODE_PATH: '' } });
    assert.doesNotThrow(compile, 'the positive consumer must compile without library errors');
    const config = json(join(app, 'tsconfig.json')); config.files = ['negative.tsx']; save(join(app, 'tsconfig.json'), config);
    assert.doesNotThrow(compile, 'all nine plain-string calls must have their own type error');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
