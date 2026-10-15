import { h, createSignal, createList } from '@getforma/core';
export function Page() {
  const [rows] = createSignal([]);
  return h('main', null, 'empty-local', createList(rows, row => row.id, row => h('p', null, row.label)));
}
