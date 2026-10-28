import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

describe('browser test storage environment', () => {
  it.each(['localStorage', 'sessionStorage'] as const)('%s belongs to the DOM environment', (name) => {
    expect(globalThis[name]).toBeInstanceOf(Storage);
    expect(globalThis[name]).toBe(window[name]);
    expect(Object.getPrototypeOf(globalThis[name])).toBe(Storage.prototype);
  });

  it('keeps local and session values separate', () => {
    localStorage.setItem('environment-control', 'local');
    expect(sessionStorage.getItem('environment-control')).toBeNull();
    sessionStorage.setItem('environment-control', 'session');
    expect(localStorage.getItem('environment-control')).toBe('local');
    expect(sessionStorage.getItem('environment-control')).toBe('session');
  });

  it('restores the DOM storage objects after test globals are unstubbed', () => {
    const local = localStorage;
    const session = sessionStorage;
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    vi.unstubAllGlobals();
    expect(localStorage).toBe(local);
    expect(sessionStorage).toBe(session);
    expect(localStorage).toBeInstanceOf(Storage);
    expect(sessionStorage).toBeInstanceOf(Storage);
  });
});
