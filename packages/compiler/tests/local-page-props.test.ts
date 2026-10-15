import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { getSlots, parseOpcodeList } from './helpers/fmir';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function emit(source: string, files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-local-page-')); dirs.push(dir);
  for (const [name, text] of Object.entries({ 'app.tsx': source, ...files })) writeFileSync(join(dir, name), text);
  const result = generateRealIr(join(dir, 'app.tsx'));
  expect(result, 'a named local page must emit actual IR').not.toBeNull();
  return result!.binary;
}
const imports = "import { h, mount, createSignal } from '@getforma/core';";

describe('declared local page entry selection', () => {
  it.each([
    ['exported function', 'export function Page(p: { count: number }) { const [count] = createSignal(p.count); return <p>{count()}</p>; }', "mount(() => Page({count:0}), '#app');"],
    ['local function', 'function Page(p: { count: number }) { return <p>{p.count}</p>; }', "mount(() => Page({count:0}), '#app');"],
    ['exported arrow', 'export const Page = (p: { count: number }) => <p>{p.count}</p>;', "mount(() => Page({count:0}), '#app');"],
    ['direct reference', 'export function Page(p: { count: number }) { return <p>{p.count}</p>; }', "mount(Page, '#app');"],
    ['single return block', 'export function Page(p: { count: number }) { return <p>{p.count}</p>; }', "mount(() => { return Page({count:0}); }, '#app');"],
  ])('uses the declared root contract for a %s', (_name, declaration, mount) => {
    const binary = emit(imports + declaration + mount);
    expect(getSlots(binary).filter(s => s.source === 0).map(s => [s.name, s.default])).toEqual([['count', '']]);
    const ops = parseOpcodeList(binary).join('\n');
    expect(ops).toContain('DYN_TEXT');
    expect(ops).toContain('p');
    expect(ops).not.toContain('data-forma-page');
  });

  it('keeps imported named pages on the same declared binding path', () => {
    const binary = emit("import { mount } from '@getforma/core'; import { Page } from './page'; mount(() => Page({count:0}), '#app');", {
      'page.tsx': "import { h } from '@getforma/core'; export function Page(p: { count: number }) { return <p>{p.count}</p>; }",
    });
    expect(getSlots(binary).filter(s => s.source === 0).map(s => s.name)).toEqual(['count']);
    expect(parseOpcodeList(binary).join('\n')).toContain('DYN_TEXT');
  });

  it('keeps genuine inline mounts local and does not infer a handler contract', () => {
    const binary = emit(imports + "const [count] = createSignal(42); mount(() => h('p', null, count()), '#app');");
    expect(getSlots(binary).filter(s => s.source === 0)).toEqual([]);
    expect(getSlots(binary).find(s => s.name === 'count')).toMatchObject({ source: 1, default: '42' });
    expect(parseOpcodeList(binary).join('\n')).toContain('DYN_TEXT');
  });

  it('refuses a shadowed imported root instead of reading its unrelated contract', () => {
    expect(() => emit("import { mount } from '@getforma/core'; import { Page } from './page'; mount((Page) => Page(), '#app');", {
      'page.tsx': "import { h } from '@getforma/core'; export function Page(p: { count: number }) { return <p>{p.count}</p>; }",
    })).toThrow(/BUILD-610.*shadow/);
  });

  it('refuses reassigned local page identity before using its original declaration', () => {
    expect(() => emit(imports + "let Page = (p: { count:number }) => <p>{p.count}</p>; Page = (p: { label:string }) => <b>{p.label}</b>; mount(() => Page({label:'later'}), '#app');")).toThrow(/BUILD-610.*reassign/);
  });
});
