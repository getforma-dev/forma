import { h, createList, createSignal } from 'formajs';

// A callable source must also have native value provenance. FORMA-101 preserves
// the old callable-but-empty stage in docs/archive/FORMA-101-unproved-list-sources/.
const [todos] = createSignal([
  { id: 1, title: 'Write the corpus', owner: 'ada' },
  { id: 2, title: 'Feed it to Rust', owner: 'grace' },
]);

export function ListPage() {
  return h('section', { id: 'app' },
    // Both lists read the same closed two-row source, while their row
    // projections remain independent.
    h('ul', { class: 'todos' },
      createList(todos, (t) => t.id, (t) => h('li', { class: 'todo' }, t.title)),
    ),
    // The SAME source again, reading a different property set.
    h('ol', { class: 'recap' },
      createList(todos, (t) => t.id, (t) => h('li', null, t.owner, ' - ', t.title)),
    ),
  );
}
