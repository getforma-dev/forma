import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExperimentalNavigationGroup } from '../src/experimental-navigation';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  delete (globalThis as any).__navigationGroup;
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-navigation-group-'));
  roots.push(root);
  const coreEntry = join(root, 'core.ts');
  writeFileSync(coreEntry, `
    export function h(){throw Error('rendered during registration')}
    export function mount(){throw Error('mounted during registration')}
    export function activateIslands(){throw Error('activated during registration')}
    export const browserOnly=component=>component;
    export function __islandRegistration(component, metadata){return {component,metadata}}
    export function __adoptionChild(){}; export function __adoptionConditional(){};
    export function __adoptionSignal(){}; export function __adoptionWritable(){};
  `);
  const routes = ['a', 'b'].map(letter => {
    const name = `Counter${letter.toUpperCase()}`;
    const entry = join(root, `${letter}.ts`);
    writeFileSync(join(root, `page-${letter}.ts`), `
      import {h} from '@getforma/core';
      export function ${name}(props:{count:number}){return h('button',null,props.count)}
      export function Page(props:{count:number}){return h('main',null,${name}({count:props.count}))}
    `);
    writeFileSync(entry, `import {mount,activateIslands} from '@getforma/core';
      import {Page,${name}} from './page-${letter}';
      activateIslands({${name}}); mount(()=>Page({count:0}),'#app');
    `);
    return { path: `/proof/${letter}`, page: `proof-${letter}`, entry };
  });
  const client = join(root, 'client.ts');
  writeFileSync(client, 'export function startProof(group){globalThis.__navigationGroup=group}');
  return { app: 'navigation-fixture', group: 'proof', routes, client, coreEntry, outputDir: join(root, 'dist') };
}

it('builds two exact native products into one complete registration artifact with generated identity and SRI', async () => {
  const input = fixture();
  const manifest = await buildExperimentalNavigationGroup(input);
  const a = manifest.routes['/proof/a'], b = manifest.routes['/proof/b'];
  expect(a.mode).toBe('ssr');
  expect(b.mode).toBe('ssr');
  expect(a.ir).not.toBe(b.ir);
  expect(a.js).toEqual(b.js);
  expect(a.js).toHaveLength(1);
  expect(a.modulepreload).toBeUndefined();
  expect(readdirSync(input.outputDir).filter(file => file.endsWith('.js'))).toEqual(a.js);
  for (const route of [a, b]) {
    expect(readFileSync(join(input.outputDir, route.ir!)).subarray(0, 4)).toEqual(Buffer.from([137, 70, 77, 73]));
  }
  const script = readFileSync(join(input.outputDir, a.js[0]));
  expect(manifest.assets[a.js[0]].integrity).toBe(`sha384-${createHash('sha384').update(script).digest('base64')}`);
  await import(`data:text/javascript;base64,${script.toString('base64')}`);
  const group = (globalThis as any).__navigationGroup;
  expect(group.app).toBe(manifest.app);
  expect(group.build).toBe(manifest.build);
  expect(group.group).toBe('proof');
  expect(Object.keys(group.registrations)).toEqual(['CounterA', 'CounterB']);
  expect(Object.isFrozen(group.registrations)).toBe(true);
  expect(group.registrations.CounterA.metadata.h).toMatch(/^[a-f0-9]{16}$/);
  const receipt = JSON.parse(readFileSync(join(input.outputDir, 'experimental-navigation.json'), 'utf8'));
  expect(receipt.products).toHaveLength(2);
  expect(receipt.status).toBe('feasibility-only');
  expect(Object.values(receipt.metafile.outputs).every((output: any) => output.imports.length === 0)).toBe(true);
  expect(manifest.assets['experimental-navigation.json']).toBeUndefined();
});

it('retains the last complete publication when an authored registration entry gains a side effect', async () => {
  const input = fixture();
  await buildExperimentalNavigationGroup(input);
  const before = readFileSync(join(input.outputDir, 'manifest.json'));
  const entry = input.routes[1].entry;
  writeFileSync(entry, readFileSync(entry, 'utf8') + '\nglobalThis.badRegistrationEffect=true;');
  await expect(buildExperimentalNavigationGroup(input)).rejects.toThrow(/registration-only entry accepts declarations/);
  expect(readFileSync(join(input.outputDir, 'manifest.json'))).toEqual(before);
});

it('does not silently overwrite two distinct declarations that use the same registration name', async () => {
  const input = fixture();
  for (const file of [input.routes[1].entry, join(input.outputDir, '..', 'page-b.ts')]) {
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll('CounterB', 'CounterA'));
  }
  await expect(buildExperimentalNavigationGroup(input)).rejects.toThrow(/duplicate island registration CounterA/);
});

it('does not classify browserOnly replacement as native adoption proof', async () => {
  const input = fixture();
  writeFileSync(join(input.outputDir, '..', 'page-b.ts'), `
    import {h,browserOnly} from '@getforma/core';
    export const CounterB=browserOnly((props:{count:number})=>h('canvas',null,props.count));
    export function Page(props:{count:number}){return h('main',null,CounterB({count:props.count}))}
  `);
  await expect(buildExperimentalNavigationGroup(input)).rejects.toThrow(/does not qualify browserOnly/);
});
