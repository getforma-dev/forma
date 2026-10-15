import { h, mount, createList } from '@getforma/core';
const todos = () => [{ id: 1, title: 'a' }];

mount(() => (
  <main>
    <ul>{createList(todos, (r) => r.id + '!', (r) => <li>{r.title}</li>)}</ul>{/* expect: BUILD-612 */}
  </main>
), '#app');
