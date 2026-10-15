/** Fresh DOM construction for an already-owned live adoption generation.
 * This never adopts or repairs server DOM and grants no compiled authority. */
import {
  withAdoptionDescription, type ComponentDescription, type FragmentDescriptor,
  type HydrationDescriptor, type ListDescriptor, type ShowDescriptor,
} from './adoption-description.js';
import { AdoptionDomError } from './adoption-plan.js';
import { fillElement, h } from './element.js';
import { contentNs, withNamespace } from './namespace.js';

/** The caller supplies its shared live range coordinators, including ownership,
 * checked replacement, key/index semantics and failure cleanup. No CSR fallback. */
export interface MaterializeContext {
  list(desc: ListDescriptor, namespace: string | null,
    render: (item: unknown, index: () => number) => Node | null): DocumentFragment;
  dynamic(read: () => unknown, materialize: (value: unknown) => Node | null): DocumentFragment;
  show(condition: () => unknown, materialize: (shown: boolean) => Node | null): DocumentFragment;
}

function describe<T>(read: () => T, ns: string | null): T {
  return withNamespace(ns, () => withAdoptionDescription(read));
}

/** A real element keeps its parent identity, so its ordinary child writer can
 * retain scalar Text nodes. Movable Fragment roots instead need real anchors. */
function child(value: unknown, ns: string | null, context: MaterializeContext, movable: boolean): unknown {
  if (typeof value === 'function' && !movable) {
    return () => child(describe(value as () => unknown, ns), ns, context, false);
  }
  if (Array.isArray(value)) return value.map(item => child(item, ns, context, movable));
  if (value == null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return value;
  return materializeAdoption(value, ns, context);
}

export function materializeAdoption(value: unknown, ns: string | null, context: MaterializeContext): Node | null {
  return withNamespace(ns, () => withAdoptionDescription(() => materialize(value, ns, context), false));
}

function materialize(value: unknown, ns: string | null, context: MaterializeContext): Node | null {
  if (value == null || typeof value === 'boolean') return null;
  if (value instanceof Node) return value;
  if (typeof value === 'string' || typeof value === 'number') return document.createTextNode(String(value));
  if (typeof value === 'function') {
    return context.dynamic(() => describe(value as () => unknown, ns), next => materializeAdoption(next, ns, context));
  }
  if (Array.isArray(value)) return fragment(value, ns, context);
  if (typeof value !== 'object') throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');
  const desc = value as HydrationDescriptor | FragmentDescriptor | ComponentDescription | ShowDescriptor | ListDescriptor;
  switch (desc.type) {
    case 'element': {
      const element = h(desc.tag, null);
      return fillElement(element, desc.props, desc.children, () => {
        const inner = contentNs(element);
        const template = element.namespaceURI === 'http://www.w3.org/1999/xhtml' && element.localName === 'template';
        return {
          children: desc.children.map(value => child(value, inner, context, template)),
          target: template ? (element as HTMLTemplateElement).content : element,
        };
      });
    }
    case 'fragment': return fragment(desc.children, ns, context);
    case 'component':
      return materializeAdoption(describe(() => Reflect.apply(desc.component, desc.receiver, desc.args), ns), ns, context);
    case 'show':
      if (desc.conditional) {
        return context.dynamic(
          () => describe(() => (desc.condition() ? desc.whenTrue : desc.whenFalse)?.(), ns),
          next => materializeAdoption(next, ns, context),
        );
      }
      return context.show(() => describe(desc.condition, ns),
        shown => materializeAdoption(describe(() => (shown ? desc.whenTrue : desc.whenFalse)?.(), ns), ns, context),
      );
    case 'list':
      return context.list(desc, ns, (item, index) => materializeAdoption(describe(() => desc.renderFn(item, index), ns), ns, context));
    default: throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');
  }
}

function fragment(children: unknown[], ns: string | null, context: MaterializeContext): DocumentFragment {
  const result = document.createDocumentFragment();
  for (const child of children) {
    const node = materializeAdoption(child, ns, context);
    if (node) result.appendChild(node);
  }
  return result;
}
