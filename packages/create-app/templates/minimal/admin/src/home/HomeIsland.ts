import { h } from '@getforma/core';
import { count, setCount } from './store';

export function HomeIsland() {
  return h(
    'div',
    null,
    h('h1', null, 'Welcome to Forma'),
    h('p', null, () => `Count: ${count()}`),
    h('button', { onClick: () => setCount(count() + 1) }, 'Increment'),
  );
}
