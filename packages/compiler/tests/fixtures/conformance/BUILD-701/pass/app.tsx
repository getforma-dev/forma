import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [rows] = createSignal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);

mount(() => (
  <main>
    <ul>{createList(rows, (r) => r.id, (r) => <li>{r.name}</li>)}</ul>
  </main>
), '#app');
