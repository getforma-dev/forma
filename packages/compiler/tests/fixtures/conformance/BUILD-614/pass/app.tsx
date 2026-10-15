import { h, mount, createSignal } from '@getforma/core';
const [done] = createSignal(false);

mount(() => (
  <main>
    <p>{() => String(done())}</p>
  </main>
), '#app');
