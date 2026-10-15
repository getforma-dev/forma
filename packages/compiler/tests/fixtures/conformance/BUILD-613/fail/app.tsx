import { h, mount, createList } from '@getforma/core';
const todos = () => [{ id: 1, title: 'a', done: false }];

mount(() => (
  <main>
    <ul>{createList(todos, (r) => r.id, (r) => r.done ? <li>{r.title}</li> : null)}</ul>{/* expect: BUILD-613 */}
  </main>
), '#app');
