import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export function tree(directory, prefix = '') {
  const result = {};
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) Object.assign(result, tree(path, `${prefix}${name}/`));
    else result[prefix + name] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return result;
}

/** Build all five actual distributions. Packed-set callers supply their installed build and core. */
export async function buildSkewApps({ build, coreDir, outputDir = join(here, 'out') }) {
  const source = join(outputDir, 'source');
  mkdirSync(join(source, 'node_modules/@getforma'), { recursive: true });
  const coreLink = join(source, 'node_modules/@getforma/core');
  if (!existsSync(coreLink)) symlinkSync(resolve(coreDir), coreLink, 'dir');
  writeFileSync(join(source, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(source, 'app.ts'), `import { mount, activateIslands } from '@getforma/core';
import { Page, Counter } from './page';
activateIslands({ Counter });
mount(() => Page({ count: 0, label: 'browser', panels: [] }), '#app');\n`);
  const deployments = {};
  for (const name of ['A', 'B', 'B2', 'C', 'S']) {
    const label = name === 'B2' ? 'B' : name;
    writeFileSync(join(source, 'label.ts'), `export const label = ${JSON.stringify(label)};\n`);
    for (let index = 1; index <= 8; index++) writeFileSync(join(source, `panel-${index}.ts`),
      `import { label } from './label'; export const text = label + ':panel-${index}';\n`);
    writeFileSync(join(source, 'page.ts'), `import { h, createSignal } from '@getforma/core';
import { label } from './label';
type Props = { count: number; label: string; panels: string[] };
export function Counter(props: Props) {
  const [count, setCount] = createSignal(props.count);
  const [panel, setPanel] = createSignal('closed');
  let attempt = 0;
  async function openPanel(index: number) {
    try {
      const loaded = await import(props.panels[index - 1] + '?attempt=' + (++attempt));
      setPanel(loaded.text);
    } catch { setPanel('retry:' + index); }
  }
  return h('section', { id: 'counter', 'data-source': label },
    h('span', { id: 'server-label' }, props.label),
    h('span', { id: 'count' }, () => count()),
    h('button', { id: 'increment', onClick: () => setCount(count() + 1) }, 'Increment'),
    h('output', { id: 'panel' }, () => panel()),
    ${Array.from({ length: 8 }, (_, index) => `h('button', { id: 'panel-${index + 1}', onClick: () => { void openPanel(${index + 1}); } }, 'Panel ${index + 1}')`).join(',\n    ')});
}
export function Page(props: Props) { return h('main', null, Counter(props)); }\n`);
    const dist = join(outputDir, name);
    const previous = name === 'B' || name === 'B2' ? deployments.A : name === 'C' || name === 'S' ? deployments.B : undefined;
    const { manifest } = await build({
      app: 'forma-skew', codeSplitting: true, ssr: true,
      entryPoints: [
        { entry: join(source, 'app.ts'), outfile: 'app.js' },
        { entry: join(source, 'app.ts'), outfile: 'browser.js', ssr: false },
        ...Array.from({ length: 8 }, (_, index) => ({ entry: join(source, `panel-${index + 1}.ts`), outfile: `panel-${index + 1}.js`, ssr: false })),
      ],
      routes: { '/': { js: ['app'], css: [] }, '/csr': { js: ['browser'], css: [] } },
      outputDir: dist, ...(previous ? { previousDist: previous.dist } : {}), ...(name === 'S' ? { security: true } : {}),
    });
    assert.equal(manifest.routes['/'].mode, 'ssr');
    assert.equal(manifest.routes['/csr'].mode, 'browser');
    assert.ok(manifest.routes['/'].ir);
    for (let index = 1; index <= 8; index++) assert.ok(manifest.aliases[`panel-${index}.js`], `missing panel ${index}`);
    deployments[name] = { label, dist, manifest, tree: tree(dist) };
  }
  assert.equal(deployments.B.manifest.build, deployments.B2.manifest.build);
  assert.deepEqual(deployments.B.tree, deployments.B2.tree, 'identical B2 inputs must reproduce the whole distribution');
  assert.equal(Object.values(deployments.S.manifest.assets).filter(asset => asset.retained).length, 0);
  writeFileSync(join(outputDir, 'deployments.json'), JSON.stringify(deployments, null, 2) + '\n');
  return deployments;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(here, '../..');
  const { build } = await import(pathToFileURL(join(repo, 'packages/build/dist/index.js')).href);
  await buildSkewApps({ build, coreDir: join(repo, 'packages/core') });
}
