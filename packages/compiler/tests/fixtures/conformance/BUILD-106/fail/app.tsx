import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const [open] = createSignal(true);
function renderPanel() { return <p>open</p>; }

mount(() => (
  <main>
    {createShow(() => open(), renderPanel, () => <p>closed</p>)}{/* expect: BUILD-106; expect: BUILD-610 */}
  </main>
), '#app');
