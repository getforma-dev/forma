import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { checkBuildIdentity } from '../../scripts/check-build-identity.mjs';
import { DEV_DEFINE, PROD_DEFINE, FRAME_DEFINE } from '../../scripts/build-defines.mjs';

const guard = 'typeof __FORMA_BUILD__ === "string" ? __FORMA_BUILD__ : ""';
describe('deployment identity remains a consuming build constant', () => {
  it.each([PROD_DEFINE, DEV_DEFINE, FRAME_DEFINE])('core package defines preserve the guarded free identifier', define => {
    const result = transformSync(`export const bundle = ${guard}`, { define, minifySyntax: true }).code;
    expect(checkBuildIdentity(result, true)).toBeNull();
    const app = transformSync(result, { define: { __FORMA_BUILD__: '"actual-deployment"' }, minifySyntax: true }).code;
    expect(app).toContain('actual-deployment'); expect(app).not.toContain('__FORMA_BUILD__');
  });
  it.each([
    `const __FORMA_BUILD__ = "package-version"; const bundle = ${guard};`,
    `function guard(__FORMA_BUILD__) { return ${guard}; }`,
    'const bundle = __FORMA_BUILD__; // typeof __FORMA_BUILD__ === "string"',
    'const bundle = typeof __FORMA_BUILD__ === "string" ? other : "";',
    `const bundle = ${guard}; __FORMA_BUILD__ = "tampered";`,
    'const bundle = "folded-in-package";',
  ])('refuses a bound, unguarded or prematurely folded artifact: %s', code => {
    expect(checkBuildIdentity(code, true)).toBe(code.includes('__FORMA_BUILD__')
      ? 'deployment identity is bound or read outside its typeof guard'
      : 'deployment identity guard was folded away');
  });
  it('does not require an identifier in artifacts without either public activation API', () => {
    expect(checkBuildIdentity('export const number = 3')).toBeNull();
  });
});
