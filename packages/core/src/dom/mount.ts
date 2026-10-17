/**
 * Forma DOM - Mount
 *
 * Mounts a component function into a DOM container, returning an unmount handle.
 * Uses createRoot() for automatic effect disposal — no global state.
 *
 * A server-marked container is refused before component execution or root
 * creation. SSR interaction is activated through declared islands.
 */

import { createUnownedRoot } from 'forma/reactive';
import { contentNs, withNamespace } from './namespace.js';
import { skewed } from './skew.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount a component into a DOM container.
 *
 * All effects created during the component's render are tracked via
 * `createRoot()` and automatically disposed when unmount is called.
 *
 * A deployment mismatch preserves the container and returns an inert disposer.
 * Otherwise `data-forma-ssr` on the container throws `FORMA_E_MOUNT_SSR` before
 * component/root/effect creation and without changing the server DOM.
 * Use compiler-declared `activateIslands` for SSR interaction. Normal Browser
 * mounting and the separate public `hydrateIsland` API are unchanged.
 *
 * @param component  A function returning an HTMLElement or DocumentFragment.
 * @param container  An HTMLElement or a CSS selector string.
 * @returns An unmount function that removes the DOM and disposes all effects.
 *
 * ```ts
 * const unmount = mount(() => h('h1', null, 'Hello'), '#app');
 * // later…
 * unmount();
 * ```
 */
export function mount(
  component: () => HTMLElement | DocumentFragment,
  container: HTMLElement | string,
): () => void {
  const target =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container)
      : container;

  if (!target) {
    throw new Error(`mount: container not found — "${container}"`);
  }

  if (skewed(target)) return () => {};

  if (target.hasAttribute('data-forma-ssr')) {
    throw new Error('FORMA_E_MOUNT_SSR: mount cannot render a server-marked root; use declared activateIslands');
  }

  let disposeRoot!: () => void;
  // The component is built in the container's content namespace: SVG into SVG.
  // Verified by: src/dom/__tests__/namespace-resolution.test.ts > "a portal into an svg, and mount() into an svg, create SVG elements"
  const dom = createUnownedRoot((dispose) => {
    disposeRoot = dispose;
    return withNamespace(contentNs(target), component);
  });
  // Trusted Types-safe clearing; no string is written to an HTML sink.
  // Verified by: src/dom/__tests__/trusted-html.test.ts > "core's own writes raise no Trusted Types violation: mount, unmount, the null clear, and every sink given trustedHtml()"
  target.replaceChildren();
  target.appendChild(dom);

  // Return unmount function
  let unmounted = false;
  return () => {
    if (unmounted) return;
    unmounted = true;
    disposeRoot();
    target.replaceChildren();
  };
}
