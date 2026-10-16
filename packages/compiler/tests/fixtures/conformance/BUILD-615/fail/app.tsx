import { h, mount, createSignal, createShow } from '@getforma/core';
const [count] = createSignal(0);

mount(() => (
  <main>
    {createShow(() => count(), () => <p>items</p>)}{/* expect: BUILD-615 */}
  </main>
), '#app');
