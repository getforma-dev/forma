import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIslandRegistry } from '../src/island-registry';
import { collectAdoptionEdits } from '../src/adoption-hooks';
import { applySourceEdits } from '../src/source-edits';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function transformed(initial: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma-review-alias-contract-'))); roots.push(root);
  const entry = join(root, 'entry.ts');
  const source = `import {h,createSignal,activateIslands} from '@getforma/core';
export function Counter() { ${initial}; const [value] = createSignal(initial); return h('input', { value }); }
activateIslands({Counter});`;
  writeFileSync(entry, source);
  return applySourceEdits(source, collectAdoptionEdits(createIslandRegistry(entry)).get(entry) ?? []);
}
it('does not broaden a literal assertion through an immutable initializer alias', () => {
  const output = transformed("const initial = 'x' as const");
  expect(output).toContain('__forma_adoptSignal(');
  expect(output).not.toMatch(/__forma_adoptWritable\w*\(/);
});
it('does not broaden an asserted union through an immutable initializer alias', () => {
  const output = transformed("const initial = 'x' as 'x' | 'y'");
  expect(output).not.toMatch(/__forma_adoptWritable\w*\(/);
});
it('does not broaden a readonly tuple through an immutable initializer alias', () => {
  const output = transformed("const initial = ['x'] as const");
  expect(output).not.toMatch(/__forma_adoptWritable\w*\(/);
});
it('retains a scalar codec through an ordinary unannotated initializer alias', () => {
  const output = transformed("const initial = 'x'");
  expect(output).toMatch(/__forma_adoptWritable\w*\(value, value, "string"/);
});
