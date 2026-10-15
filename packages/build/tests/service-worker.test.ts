import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { APP_NAME, appCacheName, serviceWorkerSource, workerIntegrityTable } from '../src/service-worker';
import { APP_NAME_VECTORS } from './helpers/app-name-vectors';
import { CACHE_VECTORS } from './helpers/cache-vectors';

const CONTENT = 'export const correct = true;';
const digest = (text: string) => 'sha384-' + createHash('sha384').update(text).digest('base64');
const metadata = (text = CONTENT, immutable = true) => ({ immutable, integrity: digest(text) });
const BUILD = '0123456789abcdef';
const OWN = appCacheName('ledger', BUILD);
const PATH = '/_assets/app.js';
const headers = { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' };
const response = (text = CONTENT, extra = {}) => new Response(text, { headers: { ...headers, ...extra } });

function harness(development = false) {
  const listeners = new Map<string, (event: any) => void>();
  const entries = new Map<string, Map<string, Response>>();
  const pending: Promise<unknown>[] = [];
  const fetch = vi.fn(async () => response());
  const put = vi.fn(async (cache: Map<string, Response>, request: Request, value: Response) => { cache.set(new URL(request.url).pathname, value.clone()); });
  const remove = vi.fn(async (cache: Map<string, Response>, request: Request) => cache.delete(new URL(request.url).pathname));
  const storage = {
    keys: vi.fn(async () => [...entries.keys()]),
    delete: vi.fn(async (name: string) => entries.delete(name)),
    open: vi.fn(async (name: string) => {
      if (!entries.has(name)) entries.set(name, new Map());
      const cache = entries.get(name)!;
      return {
        match: async (request: Request) => cache.get(new URL(request.url).pathname)?.clone(),
        put: (request: Request, value: Response) => put(cache, request, value),
        delete: (request: Request) => remove(cache, request),
      };
    }),
  };
  const self = {
    location: { origin: 'https://forma.test' }, crypto: webcrypto as typeof webcrypto | undefined,
    addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
    skipWaiting: vi.fn(async () => {}), clients: { claim: vi.fn(async () => {}) },
  };
  const input = { app: 'ledger', build: BUILD, assets: { 'app.js': metadata(), 'later.js': metadata() }, development };
  runInNewContext(serviceWorkerSource(input), { self, caches: storage, fetch, URL, Headers, Response, btoa, Uint8Array });
  return {
    entries, fetch, storage, self, put, remove,
    seed: (value: Response, name = OWN) => { if (!entries.has(name)) entries.set(name, new Map()); entries.get(name)!.set(PATH, value); },
    settle: async () => { while (pending.length) await Promise.all(pending.splice(0)); },
    lifecycle: async (type: 'install' | 'activate') => {
      let done: Promise<unknown> | undefined;
      listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => { done = p; } });
      await done;
    },
    request: (path = PATH, options: RequestInit = {}, navigation = false) => {
      const request = new Request(new URL(path, self.location.origin), options);
      if (navigation) Object.defineProperty(request, 'mode', {value: 'navigate'});
      let result: Promise<Response> | undefined;
      listeners.get('fetch')!({
        request,
        respondWith: (p: Promise<Response>) => { result = p; },
        waitUntil: (p: Promise<unknown>) => { pending.push(p); },
      });
      return result;
    },
  };
}

describe('verified production worker', () => {
  it('fetches nothing at install, waits naturally and retires only exact v1 and own application caches', async () => {
    const w = harness();
    for (const name of [OWN, 'forma:ledger:old', 'forma:other:old', 'other-app', 'forma-dev', 'forma-0123456789ab-on-demand-v1', 'forma-maybe-a-user-cache']) w.entries.set(name, new Map());
    await w.lifecycle('install'); expect(w.fetch).not.toHaveBeenCalled(); expect(w.storage.open).not.toHaveBeenCalled();
    await w.lifecycle('activate');
    expect([...w.entries.keys()].sort()).toEqual([OWN, 'forma:other:old', 'other-app', 'forma-maybe-a-user-cache'].sort());
    expect(w.self.skipWaiting).not.toHaveBeenCalled(); expect(w.self.clients.claim).not.toHaveBeenCalled();
  });
  it('keeps the complete server retirement-name vectors, including near misses', async () => {
    const w = harness();
    for (const [name] of CACHE_VECTORS) w.entries.set(name, new Map());
    await w.lifecycle('activate');
    for (const [name, , removed] of CACHE_VECTORS) expect(w.entries.has(name), name).toBe(name === OWN || !removed);
  });
  it('authenticates network bytes once requested and rechecks a valid cached response offline', async () => {
    const w = harness(); expect(await (await w.request()!).text()).toBe(CONTENT); await w.settle();
    w.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await w.request()!).text()).toBe(CONTENT); expect(w.fetch).toHaveBeenCalledOnce();
    expect(w.entries.get(OWN)?.has('/_assets/later.js')).toBe(false);
  });
  it('never serves altered cache bytes and verifies their network replacement', async () => {
    const w = harness(); w.seed(response('export const altered = true;'));
    expect(await (await w.request()!).text()).toBe(CONTENT); await w.settle();
    expect(w.remove).toHaveBeenCalledOnce(); expect(w.fetch).toHaveBeenCalledOnce();
    w.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await w.request()!).text()).toBe(CONTENT);
  });
  it('does not fall back to a corrupt cached entry when the network is unavailable', async () => {
    const w = harness(); w.seed(response('different')); w.fetch.mockRejectedValue(new Error('offline'));
    await expect(w.request()).rejects.toThrow('offline'); await w.settle(); expect(w.entries.get(OWN)?.has(PATH)).toBe(false);
  });
  it('does not return or cache corrupt network bytes, even when their JavaScript is valid', async () => {
    const w = harness(); w.fetch.mockResolvedValue(response('export const different = true;'));
    await expect(w.request()).rejects.toThrow('FORMA_E_SW_INTEGRITY'); await w.settle(); expect(w.put).not.toHaveBeenCalled();
  });
  it('rechecks a corrupted entry on every request even if eviction and replacement writes fail', async () => {
    const w = harness(); w.seed(response('different')); w.remove.mockRejectedValue(new Error('storage')); w.put.mockRejectedValue(new Error('quota'));
    expect(await (await w.request()!).text()).toBe(CONTENT); await w.settle();
    expect(await (await w.request()!).text()).toBe(CONTENT); await w.settle(); expect(w.fetch).toHaveBeenCalledTimes(2);
  });
  it('returns verified network data when opening storage or writing the cache fails', async () => {
    const w = harness(); w.storage.open.mockRejectedValueOnce(new Error('storage'));
    expect(await (await w.request()!).text()).toBe(CONTENT);
    w.put.mockRejectedValueOnce(new Error('quota')); expect(await (await w.request()!).text()).toBe(CONTENT); await w.settle();
    w.put.mockImplementationOnce(() => new Promise(() => {})); expect(await (await w.request()!).text()).toBe(CONTENT);
  });
  it('does not wait for a stuck eviction before returning verified network bytes', async () => {
    const w = harness(); w.seed(response('different')); w.remove.mockImplementation(() => new Promise(() => {}));
    expect(await (await w.request()!).text()).toBe(CONTENT); expect(w.fetch).toHaveBeenCalledOnce();
  });
  it('never reads a second application cache or returns an unreadable own entry', async () => {
    const w = harness(); w.seed(response(), 'forma:other:old');
    expect(await (await w.request()!).text()).toBe(CONTENT); await w.settle();
    expect(w.fetch).toHaveBeenCalledOnce(); expect(w.storage.open).toHaveBeenCalledWith(OWN);
    const unreadable = response(); vi.spyOn(unreadable, 'clone').mockImplementation(() => { throw new Error('unreadable cached body'); });
    w.seed(unreadable); expect(await (await w.request()!).text()).toBe(CONTENT);
    expect(w.fetch).toHaveBeenCalledTimes(2);
  });
  it('fails protected requests closed when Web Crypto is unavailable or hashing rejects', async () => {
    const w = harness(); w.seed(response()); w.self.crypto = undefined;
    await expect(w.request()).rejects.toThrow('FORMA_E_SW_INTEGRITY');
    w.self.crypto = { subtle: { digest: async () => { throw new Error('hashing failed'); } } } as any;
    await expect(w.request()).rejects.toThrow('FORMA_E_SW_INTEGRITY'); expect(w.put).not.toHaveBeenCalled();
  });
  it('fails closed when reading a protected response fails', async () => {
    const w = harness(); const broken = response(); vi.spyOn(broken, 'clone').mockImplementation(() => { throw new Error('unreadable'); });
    w.fetch.mockResolvedValue(broken); await expect(w.request()).rejects.toThrow('FORMA_E_SW_INTEGRITY'); expect(w.put).not.toHaveBeenCalled();
  });
  it.each([
    { 'Content-Type': 'text/html' }, { 'Content-Type': 'application/json' },
    { 'Cache-Control': 'private, immutable' }, { 'Cache-Control': 'no-store, immutable' }, { 'Cache-Control': 'public, max-age=10' },
  ])('refuses ineligible cached and network metadata even with matching bytes: %j', async extra => {
    const w = harness(); w.seed(response(CONTENT, extra));
    expect(await (await w.request()!).text()).toBe(CONTENT); await w.settle(); expect(w.fetch).toHaveBeenCalledOnce();
    w.seed(response(CONTENT, extra)); w.fetch.mockResolvedValue(response(CONTENT, extra));
    await expect(w.request()).rejects.toThrow('FORMA_E_SW_INTEGRITY');
  });
  it('refuses redirected or non-200 responses even if bytes match', async () => {
    for (const kind of ['redirected', 'status'] as const) {
      const make = (): Response => {
        const value = new Response(CONTENT, {headers, status: kind === 'status' ? 206 : 200});
        if (kind === 'redirected') {
          Object.defineProperty(value, 'redirected', {value: true});
          // Cache.match returns a clone; retain the platform redirect metadata.
          vi.spyOn(value, 'clone').mockImplementation(make);
        }
        return value;
      };
      const w = harness(); w.seed(make()); w.fetch.mockResolvedValue(make());
      await expect(w.request()).rejects.toThrow('FORMA_E_SW_INTEGRITY');
    }
  });
  it('leaves navigation, writes, private routes, query/bypass and unlisted URLs unintercepted', () => {
    const w = harness();
    for (const path of ['/', '/api/data', '/_assets/unknown.js', PATH + '?v=1', 'https://other.test' + PATH]) expect(w.request(path), path).toBeUndefined();
    for (const options of [{ method: 'POST' }, { cache: 'no-store' }, { cache: 'reload' }] as RequestInit[]) expect(w.request(PATH, options)).toBeUndefined();
    expect(w.request(PATH, {}, true)).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled(); expect(w.storage.open).not.toHaveBeenCalled();
  });
});

describe('finalized metadata and development behavior', () => {
  it('includes immutable dynamic JS/CSS/WASM by metadata, not filename hash shape', () => {
    const assets = { 'not-hashed.js': metadata(), 'nested/later.js': metadata(), 'theme.css': metadata(), 'code.wasm': metadata(), 'mutable.12345678.js': metadata(CONTENT, false), 'sw.js': metadata(), 'page.html': metadata(), 'font.woff2': metadata(), 'manifest.json': metadata(), 'frame.js': metadata(), 'a b%.js': metadata() };
    expect(workerIntegrityTable({ app: 'ledger', build: BUILD, assets, excludedFiles: ['frame.js'] })).toEqual({
      '/_assets/not-hashed.js': digest(CONTENT), '/_assets/nested/later.js': digest(CONTENT), '/_assets/theme.css': digest(CONTENT), '/_assets/code.wasm': digest(CONTENT), '/_assets/a%20b%25.js': digest(CONTENT),
    });
  });
  it('refuses invalid or shortened integrity and unsafe filename references', () => {
    for (const integrity of ['', 'sha384-short', digest(CONTENT) + '=', digest(CONTENT).replace('sha384', 'sha256')]) expect(() => workerIntegrityTable({app: 'ledger', build: BUILD, assets: {'app.js': {immutable: true, integrity}}})).toThrow('BUILD-818');
    for (const file of ['../app.js', '/app.js', 'a//app.js', 'a/./app.js', 'a\\app.js', 'a?b.js']) expect(() => workerIntegrityTable({app: 'ledger', build: BUILD, assets: {[file]: metadata()}})).toThrow('BUILD-818');
  });
  it('preserves the historical development worker bytes, network-only reads and immediate development takeover', async () => {
    const source = serviceWorkerSource({app: 'ledger', build: 'dev', assets: {}, development: true});
    expect(source).toBe(readFileSync(new URL('./fixtures/workers-0.3.0/development.js', import.meta.url), 'utf8'));
    const w = harness(true); await w.lifecycle('install'); await w.lifecycle('activate');
    expect(w.self.skipWaiting).toHaveBeenCalledOnce(); expect(w.self.clients.claim).toHaveBeenCalledOnce();
    expect((await w.request()!).headers.get('Cache-Control')).toBe('no-store');
    expect(w.fetch).toHaveBeenCalledWith(expect.any(Request), {cache: 'no-store'}); expect(w.storage.open).not.toHaveBeenCalled();
  });
  it('uses the shared application grammar and refuses old unnamed identities', () => {
    for (const app of APP_NAME_VECTORS.accepted) expect(APP_NAME.test(app)).toBe(true);
    for (const app of [...APP_NAME_VECTORS.refused, undefined]) expect(() => serviceWorkerSource({app: app as string, build: BUILD, assets: {}})).toThrow('forma:<app>:<build>');
    for (const build of ['', 'a:b', undefined]) expect(() => serviceWorkerSource({app: 'ledger', build: build as string, assets: {}})).toThrow('forma:<app>:<build>');
  });
});
