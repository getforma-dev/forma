import { h, mount, createSignal } from '@getforma/core';
const [done] = createSignal(false);

mount(() => (
  <main>
    <p>{() => done()}</p>{/* expect: BUILD-614 */}
  </main>
), '#app');
