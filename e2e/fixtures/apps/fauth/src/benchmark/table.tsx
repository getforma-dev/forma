// The handler sends the initial filtered and sorted dataset as declared values (DR-2).
// The results island owns the table's keyed list and can reorder it after adoption;
// L-58's N2 ceiling includes core's client-side list reconciler.
import { h, createList, createShow, createSignal } from '@getforma/core';

export type SortColumn = 'name' | 'score';
export type BenchmarkRow = {
  id: number;
  name: string;
  score: number;
  verdict: string;
  passed: boolean;
  failure?: string | null;
};
export type BenchmarkProps = {
  rows: BenchmarkRow[];
  rowCount: number;
  failureCount: number;
  query: string;
  sortColumn: SortColumn;
  hasRows: boolean;
  noRows: boolean;
  error?: string | null;
  hasError: boolean;
};

export const defaultBenchmark: BenchmarkProps = {
  rows: [], rowCount: 0, failureCount: 0, query: '', sortColumn: 'name', hasRows: false, noRows: true, hasError: false,
};

export function FilterBar(props: { query: string; sortColumn: SortColumn; rowCount: number }) {
  const [query, setQuery] = createSignal(props.query);
  const [sortColumn, setSortColumn] = createSignal(props.sortColumn);
  const [count] = createSignal(props.rowCount);
  return (
    <form id="filter" onSubmit={(event: Event) => event.preventDefault()}>
      <label for="bm-query">Search</label>
      <input id="bm-query" type="search" value={() => query()} onInput={(e: Event) => setQuery((e.target as HTMLInputElement).value)} />
      <label for="bm-sort">Sort by</label>
      <select id="bm-sort" value={() => sortColumn()} onChange={(e: Event) => setSortColumn((e.target as HTMLSelectElement).value as SortColumn)}>
        <option value="name">Name</option>
        <option value="score">Score</option>
      </select>
      <p id="bm-summary">Showing {() => count()} results for "{() => query()}", by {() => sortColumn()}.</p>
    </form>
  );
}

export function ResultsToolbar(props: { rows: BenchmarkRow[]; failureCount: number; hasError: boolean; error?: string | null; noRows: boolean }) {
  const [rows, setRows] = createSignal(props.rows);
  const [failures] = createSignal(props.failureCount);
  const [hasError] = createSignal(props.hasError);
  const [error] = createSignal(props.error);
  const [noRows] = createSignal(props.noRows);
  const [onlyFailures, setOnlyFailures] = createSignal(false);
  function toggle() {
    const next = !onlyFailures();
    setOnlyFailures(next);
    document.getElementById('bm-table')?.classList.toggle('failures-only', next);
    // aria-pressed takes the strings "true" and "false". A reactive boolean attribute writes the
    // empty string for true and removes the attribute for false, which assistive technology
    // does not read as a pressed state, so the click writes the string itself.
    document.getElementById('bm-failures')?.setAttribute('aria-pressed', String(next));
  }
  return (
    <div id="bm-toolbar">
      {createShow(() => hasError(), () => <p id="bm-error" role="alert">{() => error()}</p>)}
      {createShow(() => noRows(), () => <p id="bm-empty">No results yet.</p>)}
      <button id="bm-failures" type="button" aria-pressed="false" onClick={toggle}>
        Failures only ({() => failures()})
      </button>
      {createShow(() => onlyFailures(), () => <span id="bm-filtered" role="status">Showing failures only.</span>)}
      <button id="bm-reverse" type="button" onClick={() => setRows([...rows()].reverse())}>Reverse results</button>
      <table id="bm-table">
        <thead><tr><th>Name</th><th>Score</th><th>Verdict</th><th>Failure</th></tr></thead>
        <tbody>
          {createList(
            () => rows(),
            (row) => row.id,
            (row) => (
              <tr data-row={row.id} data-passed={row.passed}>
                <td>{row.name}</td>
                <td>{row.score}</td>
                <td>{row.verdict}</td>
                <td>{row.failure}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
