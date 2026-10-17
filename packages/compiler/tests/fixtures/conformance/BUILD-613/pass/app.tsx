import { h, mount, createList, createSignal } from '@getforma/core';
const [todos] = createSignal([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: true }]);

mount(() => (
  <main>
    <ul>{createList(todos, (r) => r.id, (r) => <li>{r.title}</li>)}</ul>
  </main>
), '#app');
