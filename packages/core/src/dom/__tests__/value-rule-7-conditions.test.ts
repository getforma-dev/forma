/**
 * FORMA-182 rule 7: conditions are boolean-typed (the compiler's suite refuses
 * the non-boolean `compiledCondition` shapes with BUILD-615). The rendered
 * side: createShow on a boolean selects the branch the walker selects for the
 * same slot value, static and after a toggle, and the walker's SHOW_IF range
 * adopts without a write.
 */
import { describe, expect, it } from 'vitest';
import { h } from '../element.js';
import { createShow } from '../show.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';
import { adoptServed, readVectors, WITHOUT_WRITE } from './value-rule-vectors.js';

interface WalkerVector { id: string; value: boolean; branch: 'then' | 'else' }
const conditions = readVectors<{ walker: WalkerVector[] }>('conditions.json');

describe('rule 7 vectors: a boolean condition selects the branch', () => {
  it.each(conditions.walker)('$id: createShow renders the $branch branch, static and after a toggle', ({ value, branch }) => {
    createRoot(() => {
      const [when, setWhen] = createSignal(!value);
      const host = h('div', null, createShow(when, () => h('b', null, 'then'), () => h('i', null, 'else')));
      setWhen(value);
      expect(host.textContent).toBe(branch);
      expect(h('div', null, createShow(() => value, () => h('b', null, 'then'), () => h('i', null, 'else'))).textContent).toBe(branch);
    });
  });

  it.each(conditions.walker)('$id: the walker\'s SHOW_IF range adopts without a write, and a toggle swaps the branch', async ({ value, branch }) => {
    const doc = document.implementation.createHTMLDocument();
    const host = doc.createElement('div');
    host.innerHTML = `<!--f:s0-->${branch === 'then' ? '<b>then</b>' : '<i>else</i>'}<!--/f:s0-->`;
    doc.body.append(host);
    const [when, setWhen] = createSignal(value);
    expect(await adoptServed(host, () => h('div', null, createShow(when, () => h('b', null, 'then'), () => h('i', null, 'else'))), () => {
      setWhen(!value);
      expect(host.textContent).toBe(branch === 'then' ? 'else' : 'then');
      setWhen(value);
      expect(host.textContent).toBe(branch);
    })).toEqual(WITHOUT_WRITE);
  });
});
