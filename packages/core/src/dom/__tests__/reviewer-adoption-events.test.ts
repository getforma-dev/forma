import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h } from '../element.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture() {
  document.body.innerHTML = '<button>run</button>';
  const host = document.body.firstElementChild as HTMLButtonElement;
  const installed = vi.spyOn(host, 'addEventListener');
  // Invoke the exact installed callback to observe framework containment
  // without relying on a test DOM's reporting of uncaught native event errors.
  const invoke = () => {
    const listener = installed.mock.calls.find(([name]) => name === 'click')?.[1];
    if (!listener) throw new Error('No installed click listener');
    const event = new Event('click');
    if (typeof listener === 'function') listener.call(host, event);
    else listener.handleEvent(event);
  };
  return { host, invoke };
}

describe('independent adopted event ownership', () => {
  it('owns work created by a successful listener until island disposal', () => {
    const { host, invoke } = fixture(), [value, setValue] = createSignal(0);
    const effect = vi.fn(() => { value(); });
    let cleanup: (() => void) | undefined;
    const plan = prepareAdoption(host, () => h('button', {
      onClick() { cleanup = createEffect(effect); },
    }, 'run'));
    try {
      plan.commit(); invoke(); expect(effect).toHaveBeenCalledTimes(1);
      setValue(1); expect(effect).toHaveBeenCalledTimes(2);
      plan.dispose(); setValue(2); expect(effect).toHaveBeenCalledTimes(2);
    } finally { plan.dispose(); cleanup?.(); }
  });

  it('contains a throwing listener and drains work created before its failure', () => {
    const { host, invoke } = fixture(), [value, setValue] = createSignal(0);
    const failure = vi.fn(), cause = new Error('listener failed');
    const effect = vi.fn(() => { value(); });
    let cleanup: (() => void) | undefined;
    const plan = prepareAdoption(host, () => h('button', {
      onClick() { cleanup = createEffect(effect); throw cause; },
    }, 'run'), { failure });
    try {
      plan.commit();
      expect(invoke).not.toThrow();
      expect(plan.phase).toBe('aborted');
      expect(failure).toHaveBeenCalledTimes(1);
      expect(failure.mock.calls[0]?.[0]).toBe(cause);
      setValue(1); expect(effect).toHaveBeenCalledTimes(1);
      invoke(); expect(failure).toHaveBeenCalledTimes(1);
    } finally { plan.dispose(); cleanup?.(); }
  });

  it('drains work created after a listener synchronously disposes its island', () => {
    const { host, invoke } = fixture(), [value, setValue] = createSignal(0);
    const effect = vi.fn(() => { value(); });
    let cleanup: (() => void) | undefined;
    const plan = prepareAdoption(host, () => h('button', {
      onClick() { plan.dispose(); cleanup = createEffect(effect); },
    }, 'run'));
    try {
      plan.commit(); invoke(); expect(plan.phase).toBe('aborted');
      const calls = effect.mock.calls.length;
      setValue(1); expect(effect).toHaveBeenCalledTimes(calls);
    } finally { plan.dispose(); cleanup?.(); }
  });
});
