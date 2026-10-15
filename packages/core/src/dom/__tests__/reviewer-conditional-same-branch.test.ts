import { describe, expect, it } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { __adoptionConditional } from '../adoption-description.js';
import { h } from '../element.js';
import { createSignal } from '../../reactive/signal.js';

describe('admitted outer conditional readers', () => {
  it('updates eager branch content when the condition remains truthy, as ordinary CSR does', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<section><!--f:s1--><b><!--f:t0-->1<!--/f:t0--></b><!--/f:s1--></section>';
    const host = doc.body.firstElementChild!, original = host.querySelector('b');
    const [value, setValue] = createSignal(1);
    const plan = prepareAdoption(host, () => h('section', null, () => __adoptionConditional(
      () => value(), () => h('b', null, value()), () => null,
    )));
    plan.commit();
    expect(host.querySelector('b')).toBe(original);
    const [ordinaryValue, setOrdinaryValue] = createSignal(1);
    const ordinary = h('section', null, () => ordinaryValue() ? h('b', null, ordinaryValue()) : null);
    setOrdinaryValue(2);
    expect(ordinary.querySelector('b')!.textContent).toBe('2');
    try {
      setValue(2);
      expect(host.querySelector('b')!.textContent).toBe('2');
    } finally { plan.dispose(); }
  });
});
