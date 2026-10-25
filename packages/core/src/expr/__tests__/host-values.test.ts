import { describe, expect, it } from 'vitest';
import { AS_DATA, weigh } from '../cost';
import { hostFn, hostNamespace, hostObject, isHost, type Host, type HostKind } from '../host';
import { run } from './helpers';

function fixture() {
  let reads = 0;
  const target = { get detail() { reads++; throw new Error('unavailable'); } };
  const root = { get detail() { reads++; throw new Error('unavailable'); } } as unknown as Node;
  const bound = { root, dom: false, navigate: false, use() {} };
  const kinds: Exclude<HostKind, 'namespace' | 'fn'>[] = ['element', 'event', 'classList', 'style', 'dataset', 'refs'];
  const hosts: Host[] = kinds.map(kind => hostObject(kind, target, kind, bound));
  hosts.push(hostNamespace('namespace', { nested: hosts[0] }), hostFn('fn', () => 7, 0, { nested: hosts[0] }));
  return { hosts, reads: () => reads };
}

describe('host value data boundaries', () => {
  it('enumerates only a public label for every host kind', () => {
    for (const host of fixture().hosts) {
      expect(isHost(host)).toBe(true);
      expect(Object.isFrozen(host)).toBe(true);
      expect(Object.keys(host)).toEqual(['label']);
      expect(Object.values(host)).toEqual([host.label]);
      for (const key of Reflect.ownKeys(host)) {
        if (key !== 'label') expect(Object.getOwnPropertyDescriptor(host, key)?.enumerable).toBe(false);
      }
    }
  });

  it.each([
    'JSON.stringify([value])',
    'JSON.stringify({nested: [value]})',
    'Object.values([value]).map(x => JSON.stringify({x: x})).join("")',
    'JSON.stringify([value], ["label", "target", "bound", "root", "members", "nested", "detail", "kind", "maxArgs"], 2)',
  ])('serializes nested hosts through %s without reading their implementation', expression => {
    const { hosts, reads } = fixture();
    for (const value of hosts) {
      let result: unknown;
      expect(() => { result = run(expression, { value }); }).not.toThrow();
      expect(result).toContain(`"${value.label}"`);
      expect(result).not.toMatch(/target|bound|members|detail|maxArgs|kind/);
    }
    expect(reads()).toBe(0);
  });

  it('weighs each occurrence as its public representation, including a long label', () => {
    const { hosts, reads } = fixture();
    for (const host of hosts) {
      expect(weigh([host], 1000, AS_DATA)).toBe(1 + 6 + host.label.length);
      expect(weigh([host, host], 1000, AS_DATA)).toBe(2 + 2 * (6 + host.label.length));
      expect(weigh([[host]], 1000, 2)).toBe(2);
    }
    const long = hostObject('element', {}, 'x'.repeat(1001));
    expect(weigh([long], 1000, AS_DATA)).toBeGreaterThan(1000);
    expect(reads()).toBe(0);
  });

  it('does not traverse cycles held inside hosts', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const value = hostObject('element', cyclic, 'value', { root: cyclic as unknown as Node, dom: false, navigate: false, use() {} });
    expect(run('JSON.stringify({nested: [value]})', { value })).toBe('{"nested":[{"label":"value"}]}');
    expect(weigh(value, 1000, AS_DATA)).toBe(11);
  });

  it.each(['JSON.stringify(value)', 'Object.keys(value)', 'Object.values(value)', 'Object.entries(value)', 'value.target', 'value.bound', 'value.members', 'value.toJSON()', 'Object.getOwnPropertyNames(value)'])('continues to refuse direct reach through %s', expression => {
    const value = hostObject('element', {}, 'value');
    expect(() => run(expression, { value })).toThrowError(expect.objectContaining({ code: expect.stringMatching(/^FORMA_E_/) }));
  });

  it('preserves supported dispatch, coercion and ordinary JSON budgets', () => {
    expect(run('Math.max(2, 7)')).toBe(7);
    expect(run('Number.isFinite(3)')).toBe(true);
    expect(run('JSON.stringify({a: 1, b: 2}, ["b"], 2)')).toBe('{\n  "b": 2\n}');
    expect(run('JSON.stringify(JSON.parse("{\\"a\\":[1,2]}"))')).toBe('{"a":[1,2]}');
    const value = hostObject('element', {}, 'value');
    expect(run('[value].join("")', { value })).toBe('[object Object]');
    expect(run('String([value])', { value })).toBe('[object Object]');
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(() => weigh(cyclic, 100000, AS_DATA)).toThrowError(expect.objectContaining({ code: 'FORMA_E_BUDGET' }));
    expect(() => run('JSON.stringify(value)', { value: ['x'.repeat(250001)] })).toThrowError(expect.objectContaining({ code: 'FORMA_E_BUDGET' }));
  });
});
