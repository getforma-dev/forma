import { expect, it } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h } from '../element.js';
import { createList } from '../list.js';
import { createSignal } from '../../reactive/signal.js';
import { registerDisposer } from '../../reactive/root.js';

it('keeps repeated nested LIST markers and their row owners independent', async () => {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<ul><!--f:l0--><li><ul><!--f:l0--><li>10</li><!--/f:l0--></ul></li><li><ul><!--f:l0--><li>20</li><!--/f:l0--></ul></li><!--/f:l0--></ul>';
  const host = doc.body.firstElementChild!;
  const original = [...host.querySelectorAll('li')];
  const [outer, setOuter] = createSignal([0, 1]);
  const children = [createSignal([10]), createSignal([20])];
  const cleaned: number[] = [], records: MutationRecord[] = [];
  const observer = new MutationObserver(batch => records.push(...batch));
  observer.observe(host, { subtree: true, attributes: true, characterData: true, childList: true });
  const plan = prepareAdoption(host, () => h('ul', null, createList(outer, key => key, key =>
    h('li', null, h('ul', null, createList(children[key]![0], item => item, item => {
      registerDisposer(() => cleaned.push(item));
      return h('li', null, item);
    }))))));
  try {
    plan.commit();
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    expect(records).toEqual([]);
    expect([...host.querySelectorAll('li')]).toEqual(original);
    children[0]![1]([11]);
    expect(host.children[1]!.firstElementChild!.firstElementChild).toBe(original[3]);
    expect(host.textContent).toBe('1120');
    expect(cleaned).toEqual([10]);
    setOuter([1]);
    expect(cleaned).toEqual([10, 11]);
    children[0]![1]([12]);
    children[1]![1]([21]);
    expect(host.textContent).toBe('21');
    expect(cleaned).toEqual([10, 11, 20]);
    plan.dispose();
    children[1]![1]([22]);
    expect(host.textContent).toBe('21');
    expect(cleaned).toEqual([10, 11, 20, 21]);
  } finally { plan.dispose(); observer.disconnect(); }
});
