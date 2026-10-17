import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h } from '../element.js';
import { __islandRegistration, preflightIslands } from '../island-state.js';
import { AdoptionScope } from '../../reactive/adoption-scope.js';
import { __adoptionSignal, __adoptionWritable } from '../../reactive/adoption-hooks.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('independent 3.0 controlled textarea children', () => {
  it.each([
    { early: true, prefix: '' },
    { early: false, prefix: '' },
    { early: false, prefix: 'prefix ' },
  ])('preserves initial edits then follows later signals: %j', ({ early, prefix }) => {
    const doc = document.implementation.createHTMLDocument(), digest = '0123456789abcdef';
    doc.head.innerHTML = `<script type="application/json" data-island-state>{"v":1,"s":[],"i":[{"h":"${digest}","p":{}}]}</script>`;
    doc.body.innerHTML = `<textarea data-forma-island="0" data-forma-state="0" data-forma-component="Area" data-forma-h="${digest}">${prefix}server</textarea>`;
    const area = doc.body.firstElementChild as HTMLTextAreaElement;
    const claim = preflightIslands({ Area: __islandRegistration(() => {}, { h: digest, schema: [[]], mode: 0 }) }, doc)[0]!;
    if ('error' in claim) throw claim.error;
    if (early) area.value = 'early edit';
    const liveWrites = vi.spyOn(area, 'value', 'set'), defaultWrites = vi.spyOn(area, 'defaultValue', 'set');
    let read!: () => string, write!: (value: string) => void;
    const plan = prepareAdoption(area, () => {
      const pair = __adoptionSignal(0, createSignal('server'));
      [read, write] = pair;
      const child = __adoptionWritable(read, read, 'string', 0);
      return prefix ? h('textarea', null, prefix, child) : h('textarea', null, child);
    }, { scope: options => new AdoptionScope(claim.value, options) });
    try {
      plan.commit();
      expect(read()).toBe(early ? 'early edit' : 'server');
      expect(area.value).toBe(early ? 'early edit' : `${prefix}server`);
      expect(liveWrites).not.toHaveBeenCalled(); expect(defaultWrites).not.toHaveBeenCalled();
      write('later'); expect(area.value).toBe(`${prefix}later`);
      area.value = 'typed after activation';
      write('last'); expect(area.value).toBe(`${prefix}last`);
    } finally { plan.dispose(); }
  });

  it('uses the same controlled child behavior during ordinary client rendering', () => {
    let area!: HTMLTextAreaElement, write!: (value: string) => void;
    const dispose = createRoot(stop => {
      const pair = createSignal('server'); write = pair[1];
      area = h('textarea', null, pair[0]) as HTMLTextAreaElement;
      document.body.appendChild(area);
      return stop;
    });
    try {
      area.value = 'typed after mount';
      write('later'); expect(area.value).toBe('later');
    } finally { dispose(); }
  });
});
