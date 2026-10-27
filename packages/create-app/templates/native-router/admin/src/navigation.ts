import { createNativeAdapter, createRouter, type NavigationBootstrap } from '@getforma/router';

// The build supplies this frozen registry; never fetch or replay executable code.
export default async function initialize(bootstrap: NavigationBootstrap) {
  const router = createRouter({
    root: document.querySelector<HTMLElement>('[data-forma-router-root]')!,
    recoveryKey: bootstrap.build,
    routes: [{ id: 'shell', children: [{ id: 'home', path: '/' }, { id: 'about', path: 'about' }] }],
    adapter: createNativeAdapter(bootstrap),
  });
  await router.ready;
}
