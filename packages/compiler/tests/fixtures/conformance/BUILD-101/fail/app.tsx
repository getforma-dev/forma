import { h, mount, createSignal, createShow, createList, activateIslands, browserOnly, createErrorBoundary, createSwitch, createPortal, createSuspense } from '@getforma/core';
const helpers = { extra: () => <em>extra</em> };

mount(() => (
  <main>
    <div>{helpers.extra()}</div>{/* expect: BUILD-101; expect: BUILD-610 */}
  </main>
), '#app');
