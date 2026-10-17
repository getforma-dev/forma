// NEVER MERGE. Called only after the bounded original trace stream reaches EOF.
import assert from 'node:assert/strict';
export function completeDiagnosticTrace(completion, bytes) {
  assert.equal(completion?.dataLossOccurred, false, 'trace data loss must be explicitly false');
  return { complete: true, bytes, dataLossOccurred: false };
}

// The original pinned default launch rejects command-line CDP metadata. Its
// actual spawned argv/PIDs are retained by DEBUG=pw:browser in the owned log.
export async function readDiagnosticBrowserMetadata(session) {
  return {
    version: await session.send('Browser.getVersion'),
    commandLine: { availableViaCdp: false, source: 'owned worker.log DEBUG=pw:browser launch records' },
    traceCategories: await session.send('Tracing.getCategories'),
  };
}
