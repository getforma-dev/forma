import { describe, it, expect, vi } from 'vitest';
import { AdoptionLifecycle } from '../adoption-lifecycle.js';
import { createRoot, registerDisposer } from '../root.js';
import { createEffect } from '../effect.js';
import { createSignal } from '../signal.js';

describe('preparation revocation', () => {
  it('never starts an effect after the preparing component disposes its caller', () => {
    const effect = vi.fn(), [value, setValue] = createSignal(0);
    let scope!: AdoptionLifecycle;
    createRoot(dispose => {
      scope = new AdoptionLifecycle();
      registerDisposer(() => scope.abort());
      expect(() => scope.run(() => {
        dispose();
        createEffect(() => { value(); effect(); });
      })).toThrow('FORMA_E_HYDRATE_STRUCTURE');
    });
    expect(scope.phase).toBe('aborted'); expect(effect).not.toHaveBeenCalled();
    setValue(1); expect(effect).not.toHaveBeenCalled();
  });
  it('keeps later attempted effects dormant even when the component catches the refusal', () => {
    const effect = vi.fn();
    const scope = new AdoptionLifecycle();
    expect(() => scope.run(() => {
      scope.abort();
      expect(() => createEffect(effect)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
      expect(() => createEffect(effect)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
    })).toThrow('FORMA_E_HYDRATE_STRUCTURE');
    expect(effect).not.toHaveBeenCalled();
  });
});
