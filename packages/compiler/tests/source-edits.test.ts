import { describe, expect, it } from 'vitest';
import { applySourceEdits } from '../src/source-edits';

describe('one original-source coordinate system', () => {
  it('composes nested wrappers with a separate registry replacement and hygienic imports', () => {
    const source = 'const value = Child(read); activateIslands({ Child });';
    const call = source.indexOf('Child(read)'), read = source.indexOf('read'), registry = source.indexOf('{ Child }');
    expect(applySourceEdits(source, [
      { start: 0, end: 0, text: 'import { registration } from "core";\n' },
      { start: registry, end: registry + 9, text: '{ Child: registration(Child) }' },
      { start: call, end: call, text: 'child(undefined, ' },
      { start: call + 5, end: call + 6, text: ', [' },
      { start: call + 10, end: call + 11, text: '])' },
      { start: read, end: read, text: 'writable(' },
      { start: read + 4, end: read + 4, text: ', read, "string", 1)' },
      { start: 0, end: 0, text: 'import { child, writable } from "core";\n' },
    ])).toBe('import { registration } from "core";\nimport { child, writable } from "core";\nconst value = child(undefined, Child, [writable(read, read, "string", 1)]); activateIslands({ Child: registration(Child) });');
  });

  it('refuses a nested hook hidden inside a removed entry statement and invalid spans', () => {
    expect(() => applySourceEdits('mount(Page(), root);', [
      { start: 0, end: 20, text: '' }, { start: 6, end: 6, text: 'hook(' },
    ])).toThrow('overlap');
    expect(() => applySourceEdits('value', [{ start: 0, end: 6, text: '' }])).toThrow('outside');
    expect(() => applySourceEdits('value', [{ start: 0.5, end: 1, text: '' }])).toThrow('outside');
  });
});
