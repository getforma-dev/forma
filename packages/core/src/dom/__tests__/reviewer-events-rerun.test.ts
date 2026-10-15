import { describe, it, expect, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h } from '../element.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';

describe('independent late listener ownership', () => {
  it('keeps a listener constructed by a later adopted effect rerun owned', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<button>start</button>';
    const host = doc.body.firstElementChild as HTMLButtonElement;
    const [generation, setGeneration] = createSignal(0);
    const [value, setValue] = createSignal(0);
    const runs = vi.fn(), failures = vi.fn();
    let next!: HTMLButtonElement, cleanup: (() => void) | undefined;
    const plan = prepareAdoption(host, () => h('button', {
      onClick() {
        createEffect(() => {
          generation();
          next = h('button', { onClick() { cleanup = createEffect(() => { value(); runs(); }); } }, 'later') as HTMLButtonElement;
        });
      },
    }, 'start'), { failure: failures });
    try {
      plan.commit(); host.click();
      const original = next;
      setGeneration(1); expect(next).not.toBe(original);
      next.click(); expect(runs).toHaveBeenCalledTimes(1);
      setValue(1); expect(runs).toHaveBeenCalledTimes(2);
      plan.dispose(); setValue(2);
      expect(runs).toHaveBeenCalledTimes(2);
      expect(failures).not.toHaveBeenCalled();
    } finally { plan.dispose(); cleanup?.(); }
  });
});
