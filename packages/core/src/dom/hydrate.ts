/** Public caller-owned adoption of existing server DOM. */
import { prepareAdoption, type PreparedAdoption } from './adoption.js';
import { AdoptionLifecycle } from '../reactive/adoption-lifecycle.js';
import { registerDisposer } from '../reactive/root.js';
import { isHydrateError, reportHydrateError } from './adoption-errors.js';

/**
 * Validate the component's description and attach it to the existing target.
 * Call inside createRoot so the caller owns all installed work. A marked
 * element target is the component's root; an unmarked target contains it.
 * Root Fragment/Show/List descriptions consume the target's exact children.
 *
 * Successful adoption preserves every initial node and attribute. A coded
 * mismatch reports through onError with source 'hydration' and returns the
 * same target. Initial user exceptions are cleaned up and rethrown unchanged.
 * This direct API has no compiled setter authority for early edited bindings.
 */
export function hydrateIsland(component: () => unknown, target: Element): Element {
  let plan: PreparedAdoption | undefined;
  try {
    plan = prepareAdoption(target, component, {
      target: 'public',
      failure: error => reportHydrateError(error),
      scope: options => {
        const owner = new AdoptionLifecycle(options);
        // The component itself may synchronously dispose its caller. Register
        // before executing it so partially prepared work is revoked too.
        registerDisposer(() => owner.abort());
        return owner;
      },
    });
    plan.commit();
  } catch (error) {
    plan?.dispose();
    if (!isHydrateError(error)) throw error;
    reportHydrateError(error);
  }
  return target;
}
