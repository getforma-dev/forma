/** Test caller for the retained public hydration API; this is not mount(). */
import { afterEach } from 'vitest';
import { createRoot } from 'forma/reactive';
import { hydrateIsland } from '../../hydrate.js';

const roots = new Set<() => void>();
afterEach(() => {
  for (const dispose of roots) dispose();
  roots.clear();
});

/**
 * Own reactive cleanup explicitly, forward public hydrateIsland errors unchanged,
 * and leave DOM ownership with the caller. No implicit failed-adoption disposal:
 * hydrateIsland's reported coded refusals return normally, as its public contract
 * specifies. A thrown error releases this caller's root and is rethrown.
 */
export function adoptInRoot(component: () => unknown, container: Element | string): () => void {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) throw new Error(`Test adoption target not found: ${container}`);
  return createRoot((disposeRoot) => {
    const dispose = () => { roots.delete(dispose); disposeRoot(); };
    try {
      hydrateIsland(component, target);
    } catch (error) {
      dispose();
      throw error;
    }
    roots.add(dispose);
    return dispose;
  });
}
