/** Private reporting shared by strict public adoption and island activation. */
import { AdoptionDomError } from './adoption-plan.js';
import { AdoptionScopeError } from '../reactive/adoption-lifecycle.js';
import { reportError } from '../reactive/dev.js';

/** Only framework error identities are coded refusals. A user's Error with a
 * matching message or code still follows the original user-exception path. */
export function isHydrateError(error: unknown): error is AdoptionDomError | AdoptionScopeError {
  return error instanceof AdoptionDomError || error instanceof AdoptionScopeError;
}

/** Preserve the original error for application reporting, including thrown
 * non-Error values from a later callback. Production receives the same report. */
export function reportHydrateError(error: unknown, where = ''): void {
  console.error(error instanceof Error ? error.message + where : error);
  reportError(error, 'hydration');
}
