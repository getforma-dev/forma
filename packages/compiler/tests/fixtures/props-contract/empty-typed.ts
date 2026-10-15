import { h, createSignal, createList } from '@getforma/core';
export function Page(props: {}) {
  const [rows] = createSignal([]);
  return h('main', null, 'empty-typed-local', createList(rows, row => row.id, row => h('p', null, row.label)));
}
