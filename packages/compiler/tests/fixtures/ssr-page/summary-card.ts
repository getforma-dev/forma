// Plain sub-component: inlined into the page IR (no island markers).
import { h, createSignal } from '@getforma/core';
const [tone] = createSignal('calm');

export function SummaryCard() {
  return h('article', { class: 'summary' },
    h('h2', null, 'Summary'),
    h('p', { class: () => tone() ? 'calm' : 'plain' }, 'All systems nominal'),
  );
}
