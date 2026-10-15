import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { getSlots, parseOpcodeList } from './helpers/fmir';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function emit(source: string, files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-review-local-entry-')); dirs.push(dir);
  for (const [name, body] of Object.entries({ 'entry.tsx': source, ...files })) writeFileSync(join(dir, name), body);
  return generateRealIr(join(dir, 'entry.tsx'));
}
const prelude = "import { h, mount, createSignal } from '@getforma/core';";
it.each([
  ['local arrow', 'const Page = ({ count: value }: { count: number }) => <strong>{value}</strong>;'],
  ['function expression', 'const Page = function({ count: value }: { count: number }) { return <strong>{value}</strong>; };'],
  ['exported function expression', 'export const Page = function({ count: value }: { count: number }) { return <strong>{value}</strong>; };'],
])('preserves declared contract and dynamic output for %s', (_name, declaration) => {
  const result = emit(prelude + declaration + "mount(() => Page({ count: 19 }), '#app');")!;
  expect(result).not.toBeNull();
  expect(getSlots(result.binary).filter(s => s.source === 0).map(s => [s.name, s.default])).toEqual([['count', '']]);
  expect(parseOpcodeList(result.binary).join('\n')).toContain('strong');
  expect(parseOpcodeList(result.binary).join('\n')).toContain('DYN_TEXT');
});
it('keeps aliased imported page identity', () => {
  const result = emit("import { mount } from '@getforma/core'; import { Actual as Page } from './page'; mount(Page, '#app');", {
    'page.tsx': "import { h } from '@getforma/core'; export function Actual(p: { count:number }) { return <em>{p.count}</em>; }",
  })!;
  expect(result).not.toBeNull();
  expect(getSlots(result.binary).filter(s => s.source === 0).map(s => s.name)).toEqual(['count']);
  expect(parseOpcodeList(result.binary).join('\n')).toContain('DYN_TEXT');
});
it('refuses a shadowed local function in a nested lexical scope', () => {
  expect(() => emit(prelude + "function Page(p: { count:number }) { return <p>{p.count}</p>; } function boot(Page: () => unknown) { mount(() => Page(), '#app'); } boot(() => null);")).toThrow(/BUILD-611.*standalone top-level/);
});
it('preserves actual inline lexical state through a block callback', () => {
  const result = emit(prelude + "mount(() => { const [label] = createSignal('kept'); return <span>{label()}</span>; }, '#app');")!;
  expect(result).not.toBeNull();
  expect(getSlots(result.binary).filter(s => s.source === 0)).toEqual([]);
  expect(getSlots(result.binary).find(s => s.name === 'label')).toMatchObject({ source: 1, default: 'kept' });
  expect(parseOpcodeList(result.binary).join('\n')).toContain('DYN_TEXT');
});
