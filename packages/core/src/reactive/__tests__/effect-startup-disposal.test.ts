import { describe, expect, it, vi } from 'vitest';
import { createEffect, internalEffect, withAdoptionEffectFailure } from '../effect.js';
import { withAdoptionCallbacks, withAdoptionSink, type DeferredEffect } from '../adoption-hooks.js';
import { createSignal } from '../signal.js';
import { createRoot, getOwner, registerDisposer } from '../root.js';
import { onCleanup } from '../cleanup.js';
import { onError } from '../dev.js';

describe('failed effect startup teardown', () => {
  for (const captured of [false, true]) {
    it(`disposes the first generation if development reporting escapes (${captured ? 'captured' : 'ordinary'})`, () => {
      const [value, set] = createSignal(0), cleaned: string[] = [];
      const error = Error('reporter failed'); let calls = 0;
      const logger = vi.spyOn(console, 'error').mockImplementation(() => { throw error; });
      const off = onError(() => onCleanup(() => cleaned.push('reporter')));
      const body = () => {
        calls++; value();
        createRoot(() => registerDisposer(() => cleaned.push('child')));
        onCleanup(() => cleaned.push('body'));
        throw Error('body failed');
      };
      try {
        expect(() => captured ? withAdoptionCallbacks(fn => fn(), () => createEffect(body)) : createEffect(body)).toThrow(error);
        expect(cleaned).toEqual(['child', 'body', 'reporter']);
        logger.mockImplementation(() => {});
        set(1);
        expect(calls).toBe(1);
        expect(cleaned).toEqual(['child', 'body', 'reporter']);
        expect(getOwner()).toBeNull();
      } finally { off(); logger.mockRestore(); }
    });
  }

  it('drains a deferred first generation when its adoption failure handler throws', () => {
    const [value, set] = createSignal(0), cleaned: string[] = [];
    const error = Error('failure handler escaped'); let calls = 0, start: DeferredEffect | undefined;
    withAdoptionSink({ deferEffect(next) { start = next; return () => {}; } }, () => createEffect(() => {
      calls++; value();
      onCleanup(() => cleaned.push('body'));
      createRoot(() => registerDisposer(() => cleaned.push('child')));
      throw Error('body failed');
    }));
    expect(() => start!(() => { onCleanup(() => cleaned.push('reporter')); throw error; })).toThrow(error);
    expect(cleaned).toEqual(['child', 'body', 'reporter']);
    expect(getOwner()).toBeNull();
    set(1);
    expect(calls).toBe(1);
    expect(cleaned).toEqual(['child', 'body', 'reporter']);
  });

  it('unsubscribes before a failed startup cleanup reporter can escape', () => {
    const [value, set] = createSignal(0);
    const bodyError = Error('body'), reporterError = Error('reporter');
    let calls = 0, cleanupCalls = 0;
    const logger = vi.spyOn(console, 'error').mockImplementation(() => { throw reporterError; });
    try {
      expect(() => createRoot(() => createEffect(() => {
        calls++; value();
        onCleanup(() => { cleanupCalls++; throw Error('cleanup'); });
        throw bodyError;
      }))).toThrow(reporterError);
      expect(getOwner()).toBeNull();
      expect(cleanupCalls).toBe(1);
      logger.mockImplementation(() => {});
      set(1);
      expect(calls).toBe(1);
    } finally { logger.mockRestore(); }
  });

  it('stops an adopted raw node after synchronous disposal during its initial callback', () => {
    const [value, set] = createSignal(0), cleaned: string[] = [];
    let calls = 0;
    const stop = withAdoptionEffectFailure(() => {}, () => internalEffect(() => {
      calls++; value();
      onCleanup(() => cleaned.push('before'));
      (getOwner() as unknown as { dispose(): void }).dispose();
      onCleanup(() => cleaned.push('after'));
      createRoot(() => registerDisposer(() => cleaned.push('child-after')));
    }));
    expect(cleaned).toEqual(['child-after', 'before', 'after']);
    set(1); stop(); stop();
    expect(calls).toBe(1);
    expect(cleaned).toEqual(['child-after', 'before', 'after']);
  });
});
