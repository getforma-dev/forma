// Full deterministic reference state. These checks run outside the timing window.
import { createDataGenerator } from './shared/data.js';
export function createModel() {
  const build = createDataGenerator(42);
  let rows = [], selected = null;
  return {
    apply(action) {
      if (action === 'clear') { rows = []; selected = null; }
      else if (action === 'run' || action === 'runlots') { rows = build(action === 'run' ? 1000 : 10000); selected = null; }
      else if (action === 'add') rows.push(...build(1000));
      else if (action === 'update') rows.forEach((r, i) => { if (i % 10 === 0) r.label += ' !!!'; });
      else if (action === 'swaprows') [rows[1], rows[998]] = [rows[998], rows[1]];
      else if (action === 'select') selected = rows[2].id;
      else if (action === 'remove') { const [removed] = rows.splice(2, 1); if (removed.id === selected) selected = null; }
      else throw new Error('Unknown action: ' + action);
    },
    expected() { return { ids: rows.map(r => String(r.id)), labels: rows.map(r => r.label), selected: selected === null ? [] : [String(selected)] }; },
  };
}
export function checkState(state, expected) {
  const problems = [];
  for (const field of ['ids', 'labels', 'selected']) {
    if (!Array.isArray(state[field]) || state[field].length !== expected[field].length || state[field].some((value, i) => value !== expected[field][i]))
      problems.push(`${field} differs from deterministic reference (${expected[field].length} expected)`);
  }
  if (state.keyed !== true) problems.push('surviving rows did not preserve DOM node identity');
  return problems;
}
