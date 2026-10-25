// Diagnostic handwritten lowering for an intentional new CSR contract.
// Uses the exact same package module imported by core's public createList/createRoot.
import { internalEffect, registerDisposer } from '../../../node_modules/@getforma/core/dist/chunk-PC2Z5PDA.js';
const template = document.createElement('template');
template.innerHTML = '<tr><td class="col-id"> </td><td><a class="lbl"> </a></td><td><a class="remove">x</a></td></tr>';
export function makeDelegatedRows(selected, setSelected, remove) {
  const handlers = new WeakMap();
  return {
    attach(tbody) {
      const controller = new AbortController();
      tbody.addEventListener('click', event => {
        for (const node of event.composedPath()) {
          if (node === tbody) break;
          const action = handlers.get(node);
          if (action) { action(); break; }
        }
      }, { signal: controller.signal });
      registerDisposer(() => controller.abort());
    },
    render(row) {
      const tr = template.content.firstChild.cloneNode(true);
      const id = tr.firstChild.firstChild;
      const label = tr.children[1].firstChild;
      const text = label.firstChild;
      const removeLink = tr.children[2].firstChild;
      id.data = String(row.id);
      let previousClass = '';
      internalEffect(() => {
        const next = selected() === row.id ? 'danger' : '';
        if (next !== previousClass) { tr.className = next; previousClass = next; }
      });
      internalEffect(() => { text.data = row.label(); });
      handlers.set(label, () => setSelected(row.id));
      handlers.set(removeLink, () => remove(row.id));
      registerDisposer(() => { handlers.delete(label); handlers.delete(removeLink); });
      return tr;
    },
  };
}
