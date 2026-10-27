// Full-document control: same compiled owners, ordinary public initial hydration,
// no router import, no enhancement. Every measured transition loads a new document.
import { activateIslands } from '@getforma/core';
import type { NavigationBootstrap } from '@getforma/build';
export default function initialize(bootstrap: NavigationBootstrap) {
  const ready = activateIslands(bootstrap.registrations).then(() => ({at:performance.now(),build:bootstrap.build}));
  const frame = ready.then(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
  (window as any).__documentBench = { ready, frame, build:bootstrap.build };
}
