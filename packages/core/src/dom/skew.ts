// Replaced only by the consuming application's build, never core's package build.
declare const __FORMA_BUILD__: string | undefined;

const verdicts = new WeakMap<Document, boolean>();

/** Refuse a deployment mismatch before any public activation side effect. */
export function skewed(root: ParentNode): boolean {
  const doc = (root as Node).nodeType === 9 ? root as Document : (root as Node).ownerDocument;
  if (!doc) return false;
  const known = verdicts.get(doc);
  if (known !== undefined) return known;
  const bundle = typeof __FORMA_BUILD__ === 'string' ? __FORMA_BUILD__ : '';
  // forma-server emits this direct body child. Descendant/earlier attributes are
  // not the page's authority, including when activation requests a subtree.
  const page = doc.body?.querySelector(':scope > div#app')?.getAttribute('data-forma-build');
  const mismatch = !!(page && bundle && page !== bundle);
  verdicts.set(doc, mismatch); // Reentrant event listeners see the same verdict.
  if (!mismatch) return false;

  for (const host of doc.querySelectorAll('[data-forma-island]')) host.setAttribute('data-forma-status', 'skew');
  const view = doc.defaultView;
  const key = 'forma:skew:' + page;
  let storage: Storage | undefined;
  let reload = false;
  try { storage = view?.sessionStorage; reload = !!storage && storage.getItem(key) === null; } catch { /* Inert without storage. */ }
  const event = new (view?.CustomEvent ?? CustomEvent)('forma:skew', { cancelable: true, detail: { page, bundle, reload } });
  if (doc.dispatchEvent(event) && reload) {
    try {
      storage!.setItem(key, '1');
      if (storage!.getItem(key) === '1') view?.location.reload();
    } catch { /* A denied write or navigation must never enable a reload loop. */ }
  }
  return true;
}
