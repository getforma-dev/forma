import { describe, expect, it, vi } from 'vitest';
import { __adoptionConditional, withAdoptionDescription } from '../adoption-description.js';

describe('private conditional description', () => {
  it.each([true, false, 0, '', 'value', {}])('evaluates the original test and selected branch once for %j', value => {
    const test = vi.fn(() => value), yes = vi.fn(() => 'yes'), no = vi.fn(() => 'no');
    expect(__adoptionConditional(test, yes, no)).toBe(value ? 'yes' : 'no');
    expect(test).toHaveBeenCalledOnce();
    expect(yes).toHaveBeenCalledTimes(value ? 1 : 0);
    expect(no).toHaveBeenCalledTimes(value ? 0 : 1);
  });

  it('returns a selected function without calling it and preserves thrown identity', () => {
    const returned = vi.fn(), other = vi.fn();
    expect(__adoptionConditional(() => true, () => returned, other)).toBe(returned);
    expect(returned).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled();
    const error = new Error('original condition');
    expect(() => __adoptionConditional(() => { throw error; }, other, other)).toThrow(error);
    expect(other).not.toHaveBeenCalled();
    expect(() => __adoptionConditional(() => false, other, () => { throw error; })).toThrow(error);
  });

  it('retains lexical receiver and arguments in compiler-shaped arrow thunks', () => {
    function select(this: { prefix: string }, condition: boolean, value: string) {
      return __adoptionConditional(() => condition, () => this.prefix + arguments[1], () => arguments.length);
    }
    expect(select.call({ prefix: 'prefix:' }, true, 'value')).toBe('prefix:value');
    expect(select.call({ prefix: 'prefix:' }, false, 'value')).toBe(2);
  });

  it('describes without executing any thunk or allocating DOM, then retains the original readers', () => {
    const test = vi.fn(() => true), yes = vi.fn(() => 'yes'), no = vi.fn(() => 'no');
    const create = vi.spyOn(document, 'createElement'), fragment = vi.spyOn(document, 'createDocumentFragment');
    try {
      const result = withAdoptionDescription(() => __adoptionConditional(test, yes, no)) as unknown as {
        type: string; condition: typeof test; whenTrue: typeof yes; whenFalse: typeof no;
      };
      expect(result).toEqual({ type: 'show', conditional: true, condition: test, whenTrue: yes, whenFalse: no });
      expect(test).not.toHaveBeenCalled(); expect(yes).not.toHaveBeenCalled(); expect(no).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled(); expect(fragment).not.toHaveBeenCalled();
      expect(result.condition()).toBe(true); expect(result.whenTrue()).toBe('yes');
      expect(test).toHaveBeenCalledOnce(); expect(yes).toHaveBeenCalledOnce(); expect(no).not.toHaveBeenCalled();
    } finally { create.mockRestore(); fragment.mockRestore(); }
    expect(__adoptionConditional(test, yes, no)).toBe('yes');
  });
});
