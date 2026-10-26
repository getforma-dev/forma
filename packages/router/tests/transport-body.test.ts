import { describe, expect, it } from 'vitest';
import { BODY_LIMIT, readBody, media } from '../src/transport';

function body(chunks: Uint8Array[], close = true) {
  let index = 0, cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else if (close) controller.close();
    },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  return { response: new Response(stream), cancelled: () => cancelled };
}

describe('bounded streaming UTF-8 transport', () => {
  it('preserves split codepoints and only strips the initial BOM', async () => {
    const text = '\ufeffAé🌍中\ufeffZ';
    const bytes = new TextEncoder().encode(text);
    const expected = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (let split = 0; split <= bytes.length; split++) {
      const { response } = body([bytes.slice(0, split), bytes.slice(split)]);
      expect(await readBody(response), `split ${split}`).toBe(expected);
      expect(response.body!.locked).toBe(false);
    }
    expect(await readBody(body([...bytes].map(byte => Uint8Array.of(byte))).response)).toBe(expected);
  });

  it.each([
    [0xff], [0xc0, 0xaf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80], [0xc3, 0x28], [0xe2, 0x82],
  ])('rejects invalid or truncated UTF-8 bytes %j', async (...bytes) => {
    const { response } = body(bytes.map(byte => Uint8Array.of(byte)));
    await expect(readBody(response)).rejects.toThrow();
    expect(response.body!.locked).toBe(false);
  });

  it('accepts the exact byte ceiling and cancels a stream exceeding it', async () => {
    const exact = body([new Uint8Array(BODY_LIMIT).fill(65)]);
    expect((await readBody(exact.response)).length).toBe(BODY_LIMIT);
    const over = body([new Uint8Array(BODY_LIMIT).fill(65), Uint8Array.of(65)], false);
    await expect(readBody(over.response)).rejects.toThrow('ROUTER_BODY_LIMIT');
    expect(over.cancelled()).toBe(1);
    expect(over.response.body!.locked).toBe(false);
  });

  it('counts UTF-8 bytes rather than decoded characters', async () => {
    const text = '🌍'.repeat(BODY_LIMIT / 4);
    expect(await readBody(body([new TextEncoder().encode(text)]).response)).toBe(text);
    const over = body([new TextEncoder().encode(text), Uint8Array.of(65)], false);
    await expect(readBody(over.response)).rejects.toThrow('ROUTER_BODY_LIMIT');
    expect(over.cancelled()).toBe(1);
  });

  it('cancels promptly on a malformed prefix while the source remains open', async () => {
    const source = body([Uint8Array.of(0xff)], false);
    await expect(readBody(source.response)).rejects.toThrow();
    expect(source.cancelled()).toBe(1);
    expect(source.response.body!.locked).toBe(false);
  });

  it('cancels and releases a pending reader when its owner aborts', async () => {
    const source = body([], false), controller = new AbortController();
    const result = readBody(source.response, controller.signal);
    const reason = new Error('owner disposed');
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(source.cancelled()).toBe(1);
    expect(source.response.body!.locked).toBe(false);
  });
});


describe('exact transport media profile', () => {
  const expected = 'application/vnd.forma.navigation+json';
  it.each([
    [expected, 'no-store', 'Accept', true],
    [expected.toUpperCase() + '; CHARSET="UTF-8"', 'private, NO-STORE', 'Origin, ACCEPT', true],
    [expected + '; charset=utf-8; other=value', ' no-store , private ', ' accept , origin ', true],
    [expected, 'no-store,', 'Accept,', true],
    [expected + '; charset=utf-16', 'no-store', 'Accept', false],
    [expected + '; charset="utf8"', 'no-store', 'Accept', false],
    [expected + '; charset=utf-8; charset=latin1', 'no-store', 'Accept', false],
    ['text/html', 'no-store', 'Accept', false],
    ['', 'no-store', 'Accept', false],
    [expected, '', 'Accept', false],
    [expected, 'private, no-store-extra', 'Accept', false],
    [expected, 'no-store', '', false],
    [expected, 'no-store', 'Accept-Language', false],
  ])('checks type %s, cache %s and vary %s', (type, cache, vary, accepted) => {
    const response = new Response('', { headers: { 'Content-Type': type, 'Cache-Control': cache, Vary: vary } });
    if (accepted) expect(() => media(response, expected)).not.toThrow();
    else expect(() => media(response, expected)).toThrow('ROUTER_MEDIA');
  });
  it('refuses missing required headers', () => {
    for (const omitted of ['Content-Type', 'Cache-Control', 'Vary']) {
      const headers = new Headers({ 'Content-Type': expected, 'Cache-Control': 'no-store', Vary: 'Accept' });
      headers.delete(omitted);
      expect(() => media(new Response('', { headers }), expected)).toThrow('ROUTER_MEDIA');
    }
  });
});
