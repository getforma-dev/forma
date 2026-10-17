/**
 * FORMA-182 rule 6's attribute table (findings F2 and F3): presence only for
 * the HTML boolean set, the value's string everywhere else (`true` the word,
 * `""` a value), and false and null omit the attribute, on every client writer:
 * h() static and reactive, adoption's expectation and its later writes. The
 * walker reads the same file (its `values` as DYN_ATTR), and so do the
 * compiler's suite (`compiled`) and the three-engine replay.
 */
import { describe, expect, it } from 'vitest';
import { h } from '../element.js';
import { prepareAttribute } from '../adoption-attributes.js';
import { prepareAdoption } from '../adoption.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';
import { readVectors } from './value-rule-vectors.js';

type Value = boolean | string | number | null;
interface ValueVector { id: string; attribute: string; value: Value; html: string; dom: string | null }
const table = readVectors<{ booleanAttributes: string[]; values: ValueVector[] }>('attributes.json');
/** A value that differs from `value` in what it writes, to start a reactive binding from. */
const other = (value: Value, attribute: string): Value => table.booleanAttributes.includes(attribute) ? !value : value === 'other' ? 'another' : 'other';

describe('rule 6 attribute table: one rule on every client writer', () => {
  it.each(table.values)('$id: h() static and reactive and adoption write $dom', ({ attribute, value, dom }) => {
    expect(h('input', { id: 'ok', [attribute]: value }).getAttribute(attribute)).toBe(dom);
    createRoot(() => {
      const [current, set] = createSignal<Value>(other(value, attribute));
      const element = h('input', { id: 'ok', [attribute]: current });
      set(value);
      expect(element.getAttribute(attribute)).toBe(dom);
      expect(element.getAttribute('id')).toBe('ok');
    });
    const target = document.createElement('input');
    const prepared = prepareAttribute(target, attribute, value);
    expect(prepared.initial).toBe(dom);
    target.setAttribute(attribute, 'stale');
    prepared.write(other(value, attribute));
    prepared.write(value);
    expect(target.getAttribute(attribute)).toBe(dom);
  });

  it.each(table.values)('$id: the attribute as the walker writes it adopts without a write', ({ attribute, value, html }) => {
    const doc = document.implementation.createHTMLDocument();
    const host = doc.createElement('div');
    host.innerHTML = `<input id="ok"${html}>`;
    doc.body.append(host);
    const served = host.firstChild;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    const plan = prepareAdoption(host, () => h('div', null, h('input', { id: 'ok', [attribute]: () => value })));
    try {
      plan.commit();
      records.push(...observer.takeRecords());
      expect({ phase: plan.phase, records: records.map(record => record.attributeName ?? record.type), retained: host.firstChild === served })
        .toEqual({ phase: 'live', records: [], retained: true });
    } finally { plan.dispose(); observer.disconnect(); }
  });

  it.each(table.booleanAttributes)('%s is presence on every writer; its data- twin is the word', name => {
    for (const [attribute, dom] of [[name, ''], [`data-${name}`, 'true']] as const) {
      expect(h('input', { [attribute]: true }).getAttribute(attribute), attribute).toBe(dom);
      createRoot(() => {
        const [on, set] = createSignal(false);
        const element = h('input', { [attribute]: on });
        set(true);
        expect(element.getAttribute(attribute), attribute).toBe(dom);
      });
      expect(prepareAttribute(document.createElement('input'), attribute, true).initial, attribute).toBe(dom);
    }
  });
});
