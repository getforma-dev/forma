import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

/** JSON's standard reporter omits the run-level unhandled-error collection. */
export default class RuntimeMutationErrors {
  onTestRunEnd(_modules, unhandledErrors, reason) {
    const output = process.env.FORMA_RUNTIME_MUTATION_ERRORS;
    assert(output, 'missing runtime mutation error output');
    writeFileSync(output, JSON.stringify({ reason, errors: unhandledErrors }, null, 2) + '\n', { flag: 'wx' });
  }
}
