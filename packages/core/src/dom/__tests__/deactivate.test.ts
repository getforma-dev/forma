import { h } from '../element.js';
import { emptyRegistry, installState, useFreshDocument } from './helpers/compiled-island.js';
/**
 * Island disposal tests — deactivateIsland, deactivateAllIslands.
 *
 * Phase 1 / H3: ensures islands can be torn down to prevent
 * memory leaks during module swaps in <forma-stage>.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { activateIslands, deactivateIsland, deactivateAllIslands } from '../activate';
import { createSignal, createEffect } from 'forma/reactive';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('deactivateIsland', () => {
  it('calls the dispose function stored on the island element', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Test" data-forma-status="pending"><span>Content</span></div>
    `;
    installState();

    activateIslands(emptyRegistry({ Test: () => h('div', null, h('span', null, 'Content')) }));

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(island.getAttribute('data-forma-status')).toBe('pending');
    expect(typeof (island as any).__formaDispose).toBe('function');

    deactivateIsland(island);

    expect(island.getAttribute('data-forma-status')).toBe('disposed');
    expect((island as any).__formaDispose).toBeUndefined();
  });

  it('is idempotent — double disposal does not throw', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Test" data-forma-status="pending"><span>Content</span></div>
    `;
    installState();

    activateIslands(emptyRegistry({ Test: () => h('div', null, h('span', null, 'Content')) }));
    const island = document.querySelector('[data-forma-island]') as HTMLElement;

    deactivateIsland(island);
    expect(island.getAttribute('data-forma-status')).toBe('disposed');

    // Second call is a no-op
    expect(() => deactivateIsland(island)).not.toThrow();
    expect(island.getAttribute('data-forma-status')).toBe('disposed');
  });

  it('does nothing for an element without __formaDispose', () => {
    document.body.innerHTML = `<div data-forma-island="0" data-forma-component="X"></div>`;
    installState();
    const el = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(() => deactivateIsland(el)).not.toThrow();
  });

  it('stops effects from running after disposal', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="EffectTest" data-forma-status="pending"><span>x</span></div>
    `;
    installState();

    let effectCount = 0;
    const [count, setCount] = createSignal(0);

    activateIslands(emptyRegistry({
      EffectTest: () => {
        createEffect(() => {
          count(); // track dependency
          effectCount++;
        });
        return h('div', null, h('span', null, 'x'));
      },
    }));

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    const beforeDisposal = effectCount;

    // Signal change should trigger effect
    setCount(1);
    expect(effectCount).toBeGreaterThan(beforeDisposal);

    const afterFirstUpdate = effectCount;

    // Dispose the island
    deactivateIsland(island);

    // Signal change should NOT trigger effect anymore
    setCount(2);
    setCount(3);
    expect(effectCount).toBe(afterFirstUpdate);
  });
});

describe('deactivateAllIslands', () => {
  it('disposes all active islands under the given root', () => {
    document.body.innerHTML = `
      <div id="stage"><div data-forma-island="0" data-forma-component="A" data-forma-status="pending"><span>A</span></div><div data-forma-island="1" data-forma-component="B" data-forma-status="pending"><span>B</span></div></div>
    `;
    installState();

    activateIslands(emptyRegistry({ A: () => h('div', null, h('span', null, 'A')), B: () => h('div', null, h('span', null, 'B')) }));

    const islands = document.querySelectorAll('[data-forma-island]');
    expect(islands[0]?.getAttribute('data-forma-status')).toBe('pending');
    expect(islands[1]?.getAttribute('data-forma-status')).toBe('pending');

    const stage = document.getElementById('stage')!;
    deactivateAllIslands(stage);

    expect(islands[0]?.getAttribute('data-forma-status')).toBe('disposed');
    expect(islands[1]?.getAttribute('data-forma-status')).toBe('disposed');
  });

  it('defaults to document when no root is provided', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Solo" data-forma-status="pending"><span>Solo</span></div>
    `;
    installState();

    activateIslands(emptyRegistry({ Solo: () => h('div', null, h('span', null, 'Solo')) }));
    deactivateAllIslands();

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(island.getAttribute('data-forma-status')).toBe('disposed');
  });

  it('skips islands that are not active (error, pending, disposed)', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Active" data-forma-status="pending"><span>Active</span></div><div data-forma-island="1" data-forma-component="Missing" data-forma-status="error"><span>Error</span></div>
    `;
    installState();

    activateIslands(emptyRegistry({ Active: () => h('div', null, h('span', null, 'Active')) }));

    // Island 0 is active, Island 1 has status "error" (no registry entry)
    deactivateAllIslands();

    expect(document.querySelector('[data-forma-island="0"]')?.getAttribute('data-forma-status')).toBe('disposed');
    // The unregistered island has no retained owner to dispose.
    expect(document.querySelector('[data-forma-island="1"]')?.getAttribute('data-forma-status')).toBe('error');
  });
});

useFreshDocument();
