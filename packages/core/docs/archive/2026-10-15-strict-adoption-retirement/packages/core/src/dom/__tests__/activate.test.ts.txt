/**
 * activateIslands — multi-island activation tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { activateIslands } from '../activate';
import { compiled, emptyRegistry, installState, useFreshDocument } from './helpers/compiled-island.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('activateIslands', () => {
  it('discovers all [data-forma-island] elements and activates them', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="FormA" data-forma-status="pending">
        <p>Island 0</p>
      </div>
      <footer>Static</footer>
      <div data-forma-island="1" data-forma-component="FormB" data-forma-status="pending">
        <p>Island 1</p>
      </div>
    `;
    installState();

    const hydrateFnA = vi.fn();
    const hydrateFnB = vi.fn();

    activateIslands(emptyRegistry({ FormA: hydrateFnA, FormB: hydrateFnB }));

    // Both hydrate functions called
    expect(hydrateFnA).toHaveBeenCalledTimes(1);
    expect(hydrateFnB).toHaveBeenCalledTimes(1);

    // Status updated to 'active'
    const islands = document.querySelectorAll('[data-forma-island]');
    expect(islands[0]?.getAttribute('data-forma-status')).toBe('active');
    expect(islands[1]?.getAttribute('data-forma-status')).toBe('active');
  });

  it('passes an empty declared props object to a unary component', () => {
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="Simple" data-forma-status="pending"><span>No props</span></div>';
    installState();
    const component = vi.fn();
    activateIslands(emptyRegistry({ Simple: component }));
    expect(component).toHaveBeenCalledExactlyOnceWith({});
    expect(document.querySelector('[data-forma-island]')!.getAttribute('data-forma-status')).toBe('active');
  });

  it('error in island 0 does not prevent island 1 from activating', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Broken" data-forma-status="pending">
        <p>Broken</p>
      </div>
      <div data-forma-island="1" data-forma-component="Working" data-forma-status="pending">
        <p>Working</p>
      </div>
    `;
    installState();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workingFn = vi.fn();

    activateIslands(emptyRegistry({
      Broken: () => { throw new Error('kaboom'); },
      Working: workingFn,
    }));

    const islands = document.querySelectorAll('[data-forma-island]');
    expect(islands[0]?.getAttribute('data-forma-status')).toBe('error');
    expect(islands[1]?.getAttribute('data-forma-status')).toBe('active');
    expect(workingFn).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('missing registry entry refuses without changing the host', () => {
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="Missing" data-forma-status="pending"><p>No handler</p></div>';
    installState();
    const before = document.body.innerHTML;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands(emptyRegistry({}));
    expect(document.body.innerHTML).toBe(before);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_REGISTRATION'));
    error.mockRestore();
  });

  it('stores dispose function on island root element', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Disposable" data-forma-status="pending">
        <span>Content</span>
      </div>
    `;
    installState();

    activateIslands(emptyRegistry({ Disposable: vi.fn() }));

    const root = document.querySelector('[data-forma-island]') as any;
    expect(typeof root.__formaDispose).toBe('function');
  });

  it('transitions status through pending -> hydrating -> active', () => {
    const statusLog: string[] = [];

    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="StatusTrack" data-forma-status="pending">
        <span>Track</span>
      </div>
    `;
    installState();

    const island = document.querySelector('[data-forma-island]')!;

    // Use MutationObserver-like approach: capture status inside hydrate fn
    const hydrateFn = vi.fn(() => {
      statusLog.push(island.getAttribute('data-forma-status')!);
    });

    activateIslands(emptyRegistry({ StatusTrack: hydrateFn }));

    // During hydration, status was 'hydrating'
    expect(statusLog).toContain('hydrating');
    // After completion, status is 'active'
    expect(island.getAttribute('data-forma-status')).toBe('active');
  });

  it('handles no islands gracefully', () => {
    document.body.innerHTML = `<div>No islands here</div>`;

    // Should not throw
    expect(() => activateIslands(emptyRegistry({ SomeComponent: vi.fn() }))).not.toThrow();
  });
});

describe('activateIslands declared props projection', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('never forwards undeclared %s keys beside a declared safe field', key => {
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="Test" data-forma-status="pending"><span>Test</span></div>';
    installState([JSON.parse(`{"${key}":{"polluted":true},"safe":"ok"}`)]);
    const component = vi.fn();
    activateIslands({ Test: compiled(component, [[{ name: 'safe', type: { kind: 'string' } }]]) });
    const received = component.mock.calls[0]![0];
    expect(received).toEqual({ safe: 'ok' });
    expect(Object.getOwnPropertyNames(received)).toEqual(['safe']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('activateIslands barrel export', () => {
  it('exports activateIslands from dom/index', async () => {
    const domIndex = await import('../index');
    expect(typeof domIndex.activateIslands).toBe('function');
  });
});

useFreshDocument();
