import { h, createSignal, createList } from '@getforma/core';

interface Row {
  id: number;
  name: string;
  value: number;
}

const initialData: Row[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
  value: Math.round(Math.random() * 1000) / 10,
}));

const [rows, setRows] = createSignal(initialData);
const [sortAsc, setSortAsc] = createSignal(true);

function toggleSort() {
  setSortAsc(!sortAsc());
  setRows(
    [...rows()].sort((a, b) => (sortAsc() ? a.value - b.value : b.value - a.value)),
  );
}

export function HomeIsland() {
  return h(
    'div',
    null,
    h('h1', null, 'Dashboard'),
    h(
      'button',
      { onClick: toggleSort },
      () => `Sort by value (${sortAsc() ? '\u2191' : '\u2193'})`,
    ),
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, 'ID'),
          h('th', null, 'Name'),
          h('th', null, 'Value'),
        ),
      ),
      h(
        'tbody',
        null,
        createList(
          rows,
          (r) => r.id,
          (r) =>
            h(
              'tr',
              null,
              h('td', null, String(r.id)),
              h('td', null, r.name),
              h('td', null, r.value.toFixed(1)),
            ),
          { updateOnItemChange: 'rerender' },
        ),
      ),
    ),
  );
}
