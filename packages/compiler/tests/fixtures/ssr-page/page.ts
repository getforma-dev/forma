// SSR root component fixture. Deliberately combines every construct that
// mints a slot name — dynamic attributes, dynamic text children, a list, a
// show, an inlined sub-component and an island — so the page-wide slot-name
// namespace is exercised end to end through the real plugin.
import { h, createSignal, createList, createShow } from '@getforma/core';
import { StatusPanel } from './status-panel';
import { SummaryCard } from './summary-card';

const [title] = createSignal('Dashboard');
const [busy] = createSignal(false);
const [uptime] = createSignal(10);
const [latency] = createSignal(2);
const [rows] = createSignal([{ id: 1, name: 'First' }]);
function handleSubmit() {}

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Reports', href: '/reports' },
];

export function DashboardPage() {
  return h('section', { id: 'app', class: () => busy() ? 'page busy' : 'page' },
    h('header', null, h('h1', null, () => title())),
    h('nav', null, ...NAV_ITEMS.map((item) => h('a', { href: item.href }, item.label))),
    SummaryCard(),
    StatusPanel(),
    // Two dynamic text children at the same child index under different
    // parents, and two dynamic attributes sharing a key across nesting levels.
    h('div', { class: 'metrics' },
      h('span', null, () => uptime() + 'ms'),
      h('span', null, () => latency() + 'ms'),
    ),
    createList(rows, (r) => r.id, (r) => h('li', { class: () => busy() ? 'busy-row' : 'row' }, r.name)),
    createShow(() => busy(), () => h('p', null, 'Loading...'), () => h('p', null, 'Ready')),
    h('form', { onSubmit: handleSubmit },
      h('input', { type: 'search', placeholder: 'Filter' }),
      h('button', { disabled: () => busy() }, 'Apply'),
    ),
  );
}
