import { describe, it, expect, vi } from 'vitest';
import { isHydrateError, reportHydrateError } from '../adoption-errors.js';
import { AdoptionDomError } from '../adoption-plan.js';
import { AdoptionScopeError } from '../../reactive/adoption-lifecycle.js';
import { onError } from '../../reactive/dev.js';

describe('strict adoption error boundary', () => {
  it('recognizes every DOM and lifecycle refusal through its framework identity', () => {
    const errors = [
      ...(['NODE', 'MARKER', 'STRUCTURE', 'VALUE', 'LIST_COUNT'] as const)
        .map(code => new AdoptionDomError(`FORMA_E_HYDRATE_${code}`)),
      ...(['INPUT_TARGET', 'INPUT_CONFLICT', 'VALUE', 'STRUCTURE', 'EFFECT', 'REF'] as const)
        .map(code => new AdoptionScopeError(`FORMA_E_HYDRATE_${code}`)),
    ];
    expect(errors.every(isHydrateError)).toBe(true);
  });

  it('does not swallow user exceptions with matching messages or code accessors', () => {
    const readCode = vi.fn(() => { throw new Error('must not read code'); });
    const user = Object.defineProperty(new Error('[forma] FORMA_E_HYDRATE_NODE'), 'code', { get: readCode });
    expect(isHydrateError(user)).toBe(false);
    expect(isHydrateError(Object.assign(new Error('user'), { code: 'FORMA_E_HYDRATE_VALUE' }))).toBe(false);
    expect(isHydrateError({ code: 'FORMA_E_HYDRATE_NODE' })).toBe(false);
    expect(isHydrateError(undefined)).toBe(false);
    expect(readCode).not.toHaveBeenCalled();
  });

  it('reports the exact original value once to application observers as hydration', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observed = vi.fn();
    const stop = onError(observed);
    const error = new AdoptionDomError('FORMA_E_HYDRATE_VALUE');
    try {
      reportHydrateError(error, ' (island 1)');
      expect(observed).toHaveBeenCalledExactlyOnceWith(error, { source: 'hydration' });
      expect(log).toHaveBeenCalledWith('[forma] FORMA_E_HYDRATE_VALUE (island 1)');
      observed.mockClear();
      reportHydrateError(undefined);
      expect(observed).toHaveBeenCalledExactlyOnceWith(undefined, { source: 'hydration' });
    } finally { stop(); log.mockRestore(); }
  });
});
