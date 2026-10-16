import { mountMarkup, trustedHtml, type MountHandle, type MountOptions } from '../runtime';

const handles = new WeakMap<Element, MountHandle>();

/** Tests hand this container's markup to the real reviewed runtime, with no grants by default. */
export function mountFixture(root: Element, options: Omit<MountOptions, 'tier'> = {}): MountHandle {
  if (root.hasAttribute('data-forma-state')) {
    throw new Error('Put the test scope inside its explicit mount root');
  }
  const markup = root.innerHTML;
  unmountFixture(root);
  const handle = mountMarkup(root, trustedHtml(markup), { tier: 'reviewed', ...options });
  handles.set(root, handle);
  return handle;
}

/** Exercise handle.update without reconstructing the mount or its state. */
export function updateFixture(root: Element, markup: Parameters<MountHandle['update']>[0], options: Omit<MountOptions, 'tier'> = {}): MountHandle {
  const current = handles.get(root);
  if (current) { current.update(markup); return current; }
  const handle = mountMarkup(root, markup, { tier: 'reviewed', ...options });
  handles.set(root, handle);
  return handle;
}

export function unmountFixture(root: Element): void {
  handles.get(root)?.unmount();
  handles.delete(root);
}
