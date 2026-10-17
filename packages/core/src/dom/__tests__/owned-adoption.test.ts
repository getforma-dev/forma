import { describe, expect, it } from 'vitest';
import { createEffect, createSignal, registerDisposer } from 'forma/reactive';
import { adoptInRoot } from './helpers/owned-adoption.js';

describe('caller-owned public hydration fixture', () => {
  it('forwards a thrown component error unchanged and disposes its caller root', () => {
    const target = document.createElement('div');
    target.setAttribute('data-forma-ssr', '');
    target.appendChild(document.createElement('p'));
    document.body.appendChild(target);
    const original = target.firstChild;
    const [value, setValue] = createSignal(0);
    const error = new Error('owned fixture control');
    let effects = 0, cleanups = 0;
    expect(() => adoptInRoot(() => {
      registerDisposer(() => { cleanups++; });
      createEffect(() => { value(); effects++; });
      throw error;
    }, target)).toThrow(error);
    expect(effects).toBe(0);
    setValue(1);
    expect(effects).toBe(0);
    expect(cleanups).toBe(1);
    expect(target.firstChild).toBe(original);
    expect(target.hasAttribute('data-forma-ssr')).toBe(true);
    target.remove();
  });
});
