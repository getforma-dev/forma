import { expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption';
import { h } from '../element';
import { createSignal } from '../../reactive/signal';

it('retains delivered mutation records through the initial microtask checkpoint', async () => {
  const document = globalThis.document.implementation.createHTMLDocument();
  document.body.innerHTML = '<p title="first"><!--f:t0-->7<!--/f:t0--></p>';
  const host = document.body.firstElementChild!;
  const target = host.childNodes[1];
  const records: MutationRecord[] = [];
  const observer = new MutationObserver(batch => records.push(...batch));
  observer.observe(host, { subtree: true, attributes: true, childList: true, characterData: true });
  const [count, setCount] = createSignal(7), [title, setTitle] = createSignal('first');
  const read = vi.fn(count);
  const plan = prepareAdoption(host, () => h('p', { title }, read));
  try {
    plan.commit();
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    expect(records).toEqual([]);
    expect(read).toHaveBeenCalledOnce();
    setCount(8); setTitle('second');
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    expect(records.some(record => record.type === 'characterData')).toBe(true);
    expect(records.some(record => record.type === 'attributes')).toBe(true);
    expect(host.childNodes[1]).toBe(target);
  } finally { plan.dispose(); observer.disconnect(); }
});

it('does not resolve inherited Object names as attribute aliases', () => {
  const document = globalThis.document.implementation.createHTMLDocument();
  document.body.innerHTML = '<p tostring="one" constructor="two">text</p>';
  const host = document.body.firstElementChild!;
  const [first, setFirst] = createSignal('one'), [second, setSecond] = createSignal('two');
  const plan = prepareAdoption(host, () => h('p', { toString: first, constructor: second }, 'text'));
  try {
    plan.commit(); setFirst('next'); setSecond('last');
    expect(host.getAttribute('tostring')).toBe('next');
    expect(host.getAttribute('constructor')).toBe('last');
  } finally { plan.dispose(); }
});
