import { expect, it, vi } from 'vitest';

it('initializes the retained graph shape with explicit empty adoption contexts', async () => {
  // Module initialization must not assume it is the first user of a shared
  // adoption context. Supply ambient sentries before evaluating the module.
  const callback = (fn: () => unknown) => fn();
  const event = (listener: unknown) => listener;
  let activeCallback: typeof callback | undefined = callback;
  let activeEvent: typeof event | undefined = event;
  const observed: unknown[][] = [];
  vi.resetModules();
  vi.doMock('../adoption-hooks.js', async importOriginal => ({
    ...await importOriginal<object>(),
    getAdoptionCallbacks: () => { observed.push(['callback', activeCallback]); return activeCallback; },
    withAdoptionCallbacks: (next: typeof callback | undefined, fn: () => unknown) => {
      const previous = activeCallback;
      activeCallback = next;
      try { return fn(); } finally { activeCallback = previous; }
    },
  }));
  vi.doMock('../adoption-events.js', async importOriginal => ({
    ...await importOriginal<object>(),
    getAdoptionEvents: () => { observed.push(['event', activeEvent]); return activeEvent; },
    withAdoptionEvents: (next: typeof event | undefined, fn: () => unknown) => {
      const previous = activeEvent;
      activeEvent = next;
      try { return fn(); } finally { activeEvent = previous; }
    },
  }));
  try {
    const { createEffect } = await import('../effect.js');
    expect(observed).toEqual([['callback', undefined], ['event', undefined]]);
    expect(activeCallback).toBe(callback);
    expect(activeEvent).toBe(event);
    const { getOwner } = await import('../root.js');
    let owner: ReturnType<typeof getOwner>;
    const stop = createEffect(() => { owner = getOwner(); });
    stop();
    const anchor = (owner!.constructor as unknown as {shapeAnchor: Record<string, unknown>}).shapeAnchor;
    for (const field of ['callbacks', 'events', 'failure', 'reader', 'ownerOverride', 'deps', 'depsTail', 'subs', 'subsTail']) {
      expect(anchor[field]).toBeUndefined();
    }
  } finally {
    vi.doUnmock('../adoption-hooks.js');
    vi.doUnmock('../adoption-events.js');
    vi.resetModules();
  }
});
