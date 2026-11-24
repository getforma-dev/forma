/**
 * createSSE / createWebSocket: connection lifecycle paths beyond the happy
 * path in http-integration.test.ts and the backoff in ws-reconnect.test.ts:
 * errors, reopen, close, parsing and the reconnect switches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSSE } from '../sse';
import { createWebSocket } from '../ws';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<EventListener>>();
  constructor(
    readonly url: string,
    readonly init?: { withCredentials?: boolean },
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(event: string, cb: EventListener): void {
    const set = this.listeners.get(event) ?? new Set<EventListener>();
    set.add(cb);
    this.listeners.set(event, set);
  }
  removeEventListener(event: string, cb: EventListener): void {
    this.listeners.get(event)?.delete(cb);
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
  open(): void {
    this.onopen?.(new Event('open'));
  }
  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  named(event: string, data: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener({ data } as MessageEvent);
  }
  fail(): Event {
    const event = new Event('error');
    this.onerror?.(event);
    return event;
  }
  close(): void {
    this.closed = true;
  }
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closeCalls = 0;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
  }
  send(payload: string): void {
    this.sent.push(payload);
  }
  close(): void {
    this.closeCalls++;
    this.readyState = FakeWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  error(): void {
    this.onerror?.();
  }
  /** The server or network drops the connection. */
  drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  FakeWebSocket.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createSSE lifecycle', () => {
  function setup<T = unknown>(options?: Parameters<typeof createSSE<T>>[1]) {
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    const sse = createSSE<T>('/events', options);
    return { sse, source: FakeEventSource.instances[0]! };
  }

  it('passes withCredentials through and defaults it to false', () => {
    setup();
    setup({ withCredentials: true });
    expect(FakeEventSource.instances.map((s) => s.init?.withCredentials)).toEqual([false, true]);
  });

  it('an error records the event and marks the stream disconnected; a reopen clears it', () => {
    const { sse, source } = setup();
    source.open();
    expect(sse.connected()).toBe(true);

    const event = source.fail();
    expect(sse.connected()).toBe(false);
    expect(sse.error()).toBe(event);

    source.open();
    expect(sse.connected()).toBe(true);
    expect(sse.error()).toBeNull();
  });

  it('a message that is not JSON arrives as the raw string', () => {
    const { sse, source } = setup<string>();
    source.message('plain text');
    expect(sse.data()).toBe('plain text');
  });

  it('a custom parser handles both default messages and named events', () => {
    const parse = vi.fn((raw: string) => raw.toUpperCase());
    const { sse, source } = setup<string>({ parse });
    const seen: unknown[] = [];
    sse.on('tick', (value) => seen.push(value));

    source.message('{"a":1}');
    source.named('tick', 'abc');

    expect(sse.data()).toBe('{"A":1}');
    expect(seen).toEqual(['ABC']);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('on() returns an unsubscribe that removes exactly its own listener', () => {
    const { sse, source } = setup();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const offA = sse.on('update', (v) => a.push(v));
    sse.on('update', (v) => b.push(v));
    expect(source.listenerCount('update')).toBe(2);

    offA();
    source.named('update', '1');
    expect(a).toEqual([]);
    expect(b).toEqual([1]);
  });

  it('close() closes the source and reports disconnected', () => {
    const { sse, source } = setup();
    source.open();
    sse.close();
    expect(source.closed).toBe(true);
    expect(sse.connected()).toBe(false);
  });
});

describe('createWebSocket lifecycle', () => {
  function setup<S = unknown, R = unknown>(options?: Parameters<typeof createWebSocket<S, R>>[1]) {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    const ws = createWebSocket<S, R>('wss://socket.test', options);
    return { ws, socket: () => FakeWebSocket.instances.at(-1)! };
  }

  it('passes protocols to the socket', () => {
    setup({ protocols: ['v2', 'v1'] });
    expect(FakeWebSocket.instances[0]!.protocols).toEqual(['v2', 'v1']);
  });

  it('send() before the socket opens is not delivered', () => {
    const { ws, socket } = setup<string>();
    ws.send('early');
    expect(socket().sent).toEqual([]);

    socket().open();
    ws.send('late');
    expect(socket().sent).toEqual(['"late"']);
  });

  it('an error event sets status to error until the close that follows', () => {
    const { ws, socket } = setup({ reconnect: false });
    socket().open();
    socket().error();
    expect(ws.status()).toBe('error');
    socket().drop();
    expect(ws.status()).toBe('closed');
  });

  it('with reconnect: false a dropped connection stays closed', async () => {
    vi.useFakeTimers();
    const { ws, socket } = setup({ reconnect: false });
    socket().open();
    socket().drop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.status()).toBe('closed');
  });

  it('stops reconnecting after maxReconnects consecutive failures', async () => {
    vi.useFakeTimers();
    const { ws, socket } = setup({ maxReconnects: 2, reconnectInterval: 100, random: () => 0.5 });

    socket().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    socket().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(ws.status()).toBe('connecting');

    socket().drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(ws.status()).toBe('closed');
  });

  it('close() cancels a pending reconnect and no new socket is ever opened', async () => {
    vi.useFakeTimers();
    const { ws, socket } = setup({ reconnectInterval: 1_000, random: () => 0.9 });
    socket().open();
    socket().drop();
    expect(vi.getTimerCount()).toBe(1);

    ws.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.status()).toBe('closed');
  });

  it('close() closes an open socket, and its late close event neither reconnects nor reopens', async () => {
    vi.useFakeTimers();
    const { ws, socket } = setup();
    const first = socket();
    first.open();

    ws.close();
    expect(first.closeCalls).toBe(1);
    expect(ws.status()).toBe('closed');

    first.onclose?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.status()).toBe('closed');

    ws.send('after close');
    expect(first.sent).toEqual([]);
  });

  it('a custom parser shapes data and handler payloads; unsubscribed handlers stop hearing', () => {
    const { ws, socket } = setup<unknown, number>({ parse: (raw) => raw.length });
    const seen: number[] = [];
    const off = ws.on((n) => seen.push(n));
    socket().open();

    socket().message('abc');
    off();
    socket().message('abcdef');

    expect(ws.data()).toBe(6);
    expect(seen).toEqual([3]);
  });
});
