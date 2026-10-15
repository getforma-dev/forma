import assert from 'node:assert/strict';
import test from 'node:test';
import { requireEnforcedTrustedTypes } from './verify-release-set.mjs';

const policy = "default-src 'self'; require-trusted-types-for 'script'; trusted-types forma forma-runtime";
test('P17 checks enforced headers, refusing absent, report-only and incomplete policies', () => {
  assert.equal(requireEnforcedTrustedTypes(new Headers({ 'content-security-policy': policy })), policy);
  for (const headers of [new Headers(), new Headers({ 'content-security-policy-report-only': policy }),
    new Headers({ 'content-security-policy': "trusted-types forma forma-runtime" }),
    new Headers({ 'content-security-policy': "require-trusted-types-for 'script'" })]) {
    assert.throws(() => requireEnforcedTrustedTypes(headers));
  }
});
test('P17 refuses wildcard, default and duplicate policy creation permissions', () => {
  for (const value of ['*', 'forma forma-runtime default', "forma forma-runtime 'allow-duplicates'"])
    assert.throws(() => requireEnforcedTrustedTypes(new Headers({ 'content-security-policy': `require-trusted-types-for 'script'; trusted-types ${value}` })));
  assert.throws(() => requireEnforcedTrustedTypes(new Headers({ 'content-security-policy': `${policy}; trusted-types *` })), /duplicate/);
});
