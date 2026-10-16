import { executeCase } from './campaign';

/** Named historical/current boundaries. Values are independently compared with
 * ordinary JavaScript over identical fixed data, without production cost math. */
export function runResiduals() {
  const results: Array<{ id: string; rows: number; refused: boolean; steps: number; cost: number }> = [];
  const search = "rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q)).length";
  for (const [script, words, q] of [
    ['ascii', 'alpha beta gamma delta epsilon zeta theta iota kappa lambda mu nu xi omicron pi rho ', 'needle'],
    ['greek', 'Η γρήγορη καφέ αλεπού πηδά πάνω από τον τεμπέλη σκύλο Σοφία Αθήνα ', 'βελόνα'],
  ]) for (const count of [900, 1717, 9000, 9090, 9200]) {
    const rows = Array.from({ length: count }, (_, index) => ({
      title: `${index} ${words}`.repeat(2).slice(0, 60),
      body: `${index % 10 === 0 ? `${q} ` : ''}${words}`.repeat(4).slice(0, 200),
    }));
    const expected = rows.filter(row => (row.title + ' ' + row.body).toLowerCase().includes(q!)).length;
    const outcome = executeCase({ operation: `L50-non-latin-search/${script}`, source: search, state: { rows, q }, expected, minimumCost: 0,
      ...(count === 9200 ? { refused: 'FORMA_E_BUDGET' } : {}) });
    results.push({ id: `L50-non-latin-search/${script}`, rows: count, refused: outcome.refused, steps: outcome.meter.steps, cost: outcome.meter.cost });
  }
  for (const count of [1000, 1500]) {
    const rows = Array.from({ length: count }, (_, index) => ({ name: `row-${index}`.padEnd(20, '.') }));
    const expected = rows.reduce((s, row) => s + row.name + ', ', '').length;
    const outcome = executeCase({ operation: 'L50-reduce-plus', source: "rows.reduce((s, r) => s + r.name + ', ', '').length", state: { rows }, expected, minimumCost: 0,
      ...(count === 1500 ? { refused: 'FORMA_E_BUDGET' } : {}) });
    results.push({ id: 'L50-reduce-plus', rows: count, refused: outcome.refused, steps: outcome.meter.steps, cost: outcome.meter.cost });
  }
  return results;
}
