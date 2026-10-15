import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { getSlots, parseOpcodeList } from './helpers/fmir';

const folders: string[] = [];
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
function emit(page: string, more: Record<string, string> = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const dir = mkdtempSync(join(tmpdir(), 'forma-props-')); folders.push(dir);
  for (const [file, text] of Object.entries({ 'app.ts': `import { mount } from '@getforma/core'; import { Page } from './page'; mount(() => Page(), '#app');`, 'page.ts': page, ...more })) writeFileSync(join(dir, file), text);
  const result = generateRealIr(join(dir, 'app.ts'));
  expect(result, 'declared pages must emit actual IR').not.toBeNull();
  return result!.binary;
}
const imports = `import { h, createSignal, createList } from '@getforma/core';`;

describe('declared root slot bindings', () => {
  it('uses declared names and distinct client temporaries for nested fields and repeated lists', () => {
    const source = imports + `
      export function Page(props: { title: string; user: { name: string }; rows: { detail: { label: string }; count: number }[] }) {
        const [first] = createSignal(props.title);
        const [second] = createSignal(props.title);
        const [local] = createSignal('local default');
        return h('main', null, first(), second(), local(), props.user.name,
          createList(() => props.rows, row => row.count, row => h('p', null, row.detail.label)),
          createList(() => props.rows, row => row.count, row => h('b', null, row.count)));
      }`;
    const binary = emit(source);
    expect(getSlots(binary).filter(slot => slot.source === 0).map(slot => slot.name)).toEqual(['title', 'user', 'rows']);
    const ops = parseOpcodeList(binary).join('\n');
    expect(ops).toContain('detail'); expect(ops).toContain('label');
    expect(ops.match(/LIST /g)).toHaveLength(2);
    expect(getSlots(binary).find(slot => slot.name === 'local')?.default).toBe('local default');
    expect(emit(source)).toEqual(binary);
  });

  it('carries renamed and nested props through an inlined child, independent from local names', () => {
    const binary = emit(imports + `import { Child } from './child'; export function Page({ person: renamed }: { person: { name: string } }) { return h('main', null, Child({ data: renamed })); }`, {
      'child.ts': `import { h, createSignal as state } from '@getforma/core'; export function Child({ data }: { data: { name: string } }) { const [local] = state(data.name); return h('p', null, local()); }`,
    });
    expect(getSlots(binary).filter(slot => slot.source === 0).map(slot => slot.name)).toEqual(['person']);
    expect(parseOpcodeList(binary).join('\n')).toContain('name');
    expect(getSlots(binary).some(slot => slot.name === 'local')).toBe(false);
  });

  it('does not fill a separate child local signal from a same-named root prop', () => {
    const binary = emit(imports + `import { Child } from './child'; export function Page(props: { title: string; $slot1: string }) { return h('main', null, props.title, Child()); }`, {
      'child.ts': `import { h, createSignal } from '@getforma/core'; export function Child() { const [title] = createSignal('private'); return h('p', null, title()); }`,
    });
    const slots = getSlots(binary);
    expect(slots.filter(slot => slot.source === 0).map(slot => slot.name)).toEqual(['title', '$slot1']);
    expect(slots.filter(slot => slot.source === 1).some(slot => slot.default === 'private')).toBe(true);
    expect(new Set(slots.map(slot => slot.name)).size).toBe(slots.length);
  });

  it.each([
    `export function Page(p: { text: string }) { return h('p', null, Number(p.text)); }`,
    `export function Page(p: { date: Date }) { return h('p', null, String(p.date)); }`,
    `export function Page(p: { text: string }) { let text = p.text; text = 'new'; return h('p', null, text); }`,
    `export function Page(p: { text: string }) { p.text = 'new'; return h('p', null, p.text); }`,
    `export function Page(p: { text: string }) { return createList(() => p.text, r => r, r => h('p', null, r)); }`,
  ])('refuses an unrepresentable binding instead of changing its value: %s', source => {
    expect(() => emit(imports + source)).toThrow(/BUILD-610/);
  });

  it('does not resolve a shadowed row name as its outer prop alias', () => {
    const binary = emit(imports + `export function Page({ title, rows }: { title: string; rows: { title: string }[] }) {
      return h('main', null, title, createList(() => rows, r => r.title, title => h('p', null, title.title)));
    }`);
    const ops = parseOpcodeList(binary).join('\n');
    expect(ops).toContain('PROP');
    expect(ops.match(/DYN_TEXT/g)).toHaveLength(2);
  });
  it.each(['', 'props: {}'])('keeps an empty local list bindable with an empty root contract (%s)', parameter => {
    const binary = emit(imports + `export function Page(${parameter}) { const [rows] = createSignal([]); return h('main', null, createList(rows, row => row.id, row => h('p', null, row.label))); }`);
    expect(getSlots(binary).every(slot => slot.source === 1)).toBe(true);
    expect(parseOpcodeList(binary).join('\n')).toContain('LIST');
  });

});
