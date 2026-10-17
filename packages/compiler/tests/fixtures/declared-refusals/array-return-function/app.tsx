import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const items = ['a', 'b'];

mount(() => (
  <main>
    {/* Direct array form is covered by BUILD-701/fail. */}
    <ol>{() => items.map((i) => <li>{i}</li>)}</ol>{/* expect: BUILD-701; expect: BUILD-610 */}
  </main>
), '#app');
