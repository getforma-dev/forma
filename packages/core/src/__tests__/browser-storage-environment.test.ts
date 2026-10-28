import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorage } from '../storage/local';
import { createSessionStorage } from '../storage/session';

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

  it('keeps Forma local and session values in separate browser stores', () => {
    const local = createLocalStorage<string>('environment-control');
    const session = createSessionStorage<string>('environment-control');
    local.set('local');
    expect(session.get()).toBeNull();
    session.set('session');
    expect(local.get()).toBe('local');
    expect(session.get()).toBe('session');
    expect(localStorage.getItem('environment-control')).toBe('"local"');
    expect(sessionStorage.getItem('environment-control')).toBe('"session"');
  });

  it('restores the DOM storage objects after test globals are unstubbed', () => {
    const local = localStorage;
    const session = sessionStorage;
    const store = createLocalStorage<string>('environment-control');
    store.set('retained');
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    expect(store.get()).toBeNull();
    vi.unstubAllGlobals();
    expect(localStorage).toBe(local);
    expect(sessionStorage).toBe(session);
    expect(localStorage).toBeInstanceOf(Storage);
    expect(sessionStorage).toBeInstanceOf(Storage);
    expect(store.get()).toBe('retained');
  });
});
