// NEVER MERGE. Called only after the bounded original trace stream reaches EOF.
import assert from 'node:assert/strict';
export function completeDiagnosticTrace(completion, bytes) {
  assert.equal(completion?.dataLossOccurred, false, 'trace data loss must be explicitly false');
  return { complete: true, bytes, dataLossOccurred: false };
}
