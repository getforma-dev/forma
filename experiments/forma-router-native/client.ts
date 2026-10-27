import { createNativeAdapter, createRouter, type NavigationBootstrap } from '@getforma/router';
// Only the compiler-generated, immutable group registry enters the native adapter.
export default function initialize(bootstrap: NavigationBootstrap) {
  const initial = JSON.parse(document.querySelector("script[data-forma-navigation]")!.textContent!);
  const metrics = { errors: [] as string[], actions: [] as string[] };
  const router = createRouter({
    root: document.querySelector<HTMLElement>('[data-forma-router-root]')!,
    base: '/native/', recoveryKey: bootstrap.build,
    routes: [{ id: 'shell', children: [{ id: 'a', path: 'a' }, { id: 'b', path: 'b' }] }],
    adapter: createNativeAdapter(bootstrap),
    contextChannel: 'forma-native-fixture',
    async checkContext(signal) {
      const response = await fetch('/__native/context', { signal, cache: 'no-store', credentials: 'same-origin' });
      return response.ok && (await response.json()).context === initial.context;
    },
    onError(code) { metrics.errors.push(code); },
    onAction(outcome, form) {
      metrics.actions.push(outcome.outcome);
      if (outcome.outcome === 'validation') {
        const output = form.querySelector<HTMLElement>('#form-error');
        if (output) output.textContent = String(outcome.data.message ?? 'Validation failed');
      }
    },
  });
  (window as unknown as { __native: unknown }).__native = { router, metrics, bootstrap, ready: router.ready };
}
