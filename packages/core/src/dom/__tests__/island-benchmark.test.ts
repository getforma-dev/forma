import { expect, it } from 'vitest';
import { proveIslandWork } from '../../../bench/island-fixture';

it.each([10, 100])('benchmarks %i actual islands in fresh documents with both disposal paths', async count => {
  // A second independent Document catches accidental reuse of frozen state or
  // hosts. The shared proof also exercises every listener and its post-disposal
  // inertness, all declared fields, node retention and repeated activation.
  for (const mode of ['bulk', 'individual'] as const) {
    for (let cycle = 0; cycle < 2; cycle++) {
      await expect(proveIslandWork(count, mode)).resolves.toEqual({ activated: count, disposed: count, clicks: count });
    }
  }
});
