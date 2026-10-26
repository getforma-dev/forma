import { cleanup, createUnownedRoot } from '@getforma/core';
import { NavigationError, type RouteAdapter, type NavigationContext, type PreparedView } from './types';
function native(node: HTMLElement) { const claims = '[data-forma-ssr],[data-forma-island],[data-forma-state]'; return node.matches(claims) || node.querySelector(claims); }
type Owner = { id: string; key: string; node: HTMLElement; outlet: HTMLElement; release: () => void };
function release(owners: Owner[]) {
  const errors: unknown[] = [];
  for (const owner of [...owners].reverse()) { try { owner.release(); } catch (error) { errors.push(error); } }
  return errors;
}
/** Each route render runs once inside a separately disposable Forma root. */
export function createBrowserAdapter(): RouteAdapter {
  return Object.freeze({
    kind: 'browser' as const,
    connect(container: HTMLElement) {
      let live: Owner[] = [], closed = false;
      function prepare(context: NavigationContext): PreparedView {
        if (closed || context.signal.aborted) throw new NavigationError('ROUTER_CANCELLED');
        if (native(container)) throw new NavigationError('ROUTER_BROWSER_NATIVE_ROOT');
        const keys = context.matches.map(match => JSON.stringify([match.id, match.params, match.definition.reuseKey?.(match) ?? '']));
        let keep = 0;
        while (keep < live.length && keep < context.matches.length && live[keep].id === context.matches[keep].id && live[keep].key === keys[keep] && !(context.revalidate && keep === context.matches.length - 1)) keep++;
        const fresh: Owner[] = []; let transferred = false, disposed = false;
        try {
          for (let i = keep; i < context.matches.length; i++) {
            if (closed || context.signal.aborted) throw new NavigationError('ROUTER_CANCELLED');
            const match = context.matches[i], outlet = container.ownerDocument.createElement('div'); outlet.setAttribute('data-forma-outlet', 'child');
            let stop = () => {}; let node: HTMLElement;
            node = createUnownedRoot(dispose => {
              stop = dispose;
              const element = match.definition.render?.({ url: new URL(context.url), location: context.location, params: match.params, outlet, signal: context.signal }) ?? outlet;
              if (!(element instanceof container.ownerDocument.defaultView!.HTMLElement)) throw new NavigationError('ROUTER_RENDER_ROOT');
              return element as HTMLElement;
            });
            if (node.isConnected || native(node)) { stop(); throw new NavigationError('ROUTER_BROWSER_NATIVE_ROOT'); }
            if (i < context.matches.length - 1 && !node.contains(outlet)) { stop(); throw new NavigationError('ROUTER_OUTLET'); }
            let released = false;
            fresh.push({ id: match.id, key: keys[i], node, outlet, release() { if (released) return; released = true; try { stop(); } finally { cleanup(node); } } });
          }
          for (let i = 0; i < fresh.length - 1; i++) fresh[i].outlet.replaceChildren(fresh[i + 1].node);
        } catch (error) { release(fresh); throw error; }
        function validate() {
          if (closed || disposed || context.signal.aborted) throw new NavigationError('ROUTER_CANCELLED');
          if (native(container)) throw new NavigationError('ROUTER_BROWSER_NATIVE_ROOT');
          if (live.some(owner => !container.contains(owner.node))) throw new NavigationError('ROUTER_OWNER_MOVED', true);
          for (let i = 0; i < fresh.length - 1; i++) if (fresh[i].outlet.children.length !== 1 || fresh[i].outlet.firstElementChild !== fresh[i + 1].node) throw new NavigationError('ROUTER_OUTLET');
        }
        return {
          validate,
          commit() {
            validate();
            const old = live.slice(keep), target = keep ? live[keep - 1].outlet : container;
            const errors = release(old);
            validate();
            if (fresh.length) target.replaceChildren(fresh[0].node); else if (keep < live.length) target.replaceChildren();
            live = [...live.slice(0, keep), ...fresh]; transferred = true;
            if (errors.length) throw new AggregateError(errors, 'ROUTER_CLEANUP');
          },
          async activate() {},
          dispose() { if (disposed || transferred) return; disposed = true; const errors = release(fresh); if (errors.length) throw new AggregateError(errors, 'ROUTER_CLEANUP'); },
        };
      }
      return {
        async initialize(context: NavigationContext) { const candidate = prepare(context); try { candidate.commit(); } finally { candidate.dispose(); } },
        async prepare(context: NavigationContext) { return prepare(context); },
        invalidate() { release(live); live = []; container.replaceChildren(); },
        dispose() { if (closed) return; closed = true; const errors = release(live); live = []; if (errors.length) throw new AggregateError(errors, 'ROUTER_CLEANUP'); },
      };
    },
  });
}
