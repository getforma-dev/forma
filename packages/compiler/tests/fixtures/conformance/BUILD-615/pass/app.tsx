import { h, mount, createSignal, createShow } from '@getforma/core';
const [count] = createSignal(0);

mount(() => (
  <main>
    {createShow(() => count() > 0, () => <p>items</p>)}
  </main>
), '#app');
