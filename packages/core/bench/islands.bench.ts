/**
 * Current declared-state island activation and disposal, at 10 and 100 islands.
 *
 * Each cycle parses a fresh Document with one v1 head envelope and creates one
 * manual compiled-protocol registration. Inline data-forma-props and the legacy
 * __forma_islands channel are unsupported and are not comparison baselines.
 *
 * The parse-only control isolates document construction from the full cycle.
 * Bulk and per-island disposal use the identical payload, reactive text and
 * listener workload. Both include activation AND teardown; neither is a leaking
 * activation-only control or an isolated teardown-duration claim. Registration
 * and fresh Document setup are included explicitly in the timed names.
 *
 * Happy DOM relative microbenchmark only. Actual compiled/native browser N3
 * qualification remains the separate packed release gate.
 */
import { bench, describe } from 'vitest';
import { MACRO } from './_support';
import { clearIslandPage, islandFixture, islandMarkup, parseIslandPage, proveIslandWork } from './island-fixture';

for (const count of [10, 100] as const) {
  describe(`${count} declared-state islands`, async () => {
    const markup = islandMarkup(count);
    // No timed iteration is registered before actual props/adoption/reactivity/
    // disposal succeed. Await works for both today's and future async activation.
    await proveIslandWork(count, 'bulk');
    await proveIslandWork(count, 'individual');

    bench('fresh document: parse markup only (control)', () => {
      clearIslandPage(parseIslandPage(markup));
    }, MACRO);

    for (const mode of ['bulk', 'individual'] as const) {
      bench(`fresh document: parse + register + activate + ${mode} dispose`, async () => {
        const fixture = islandFixture(markup);
        try {
          await fixture.activate();
          const { activated, disposed } = fixture.work;
          if (activated !== count || disposed !== 0) {
            throw new Error(`expected ${count} live islands, got ${JSON.stringify(fixture.work)}`);
          }
        } finally {
          fixture.dispose(mode);
          clearIslandPage(fixture.doc);
        }
        if (fixture.work.disposed !== count) throw new Error(`expected ${count} disposals, got ${fixture.work.disposed}`);
      }, MACRO);
    }
  });
}
