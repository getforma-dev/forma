// A results page: a dataset the server holds, a filter bar and a results toolbar that are
// islands, and the table itself, which is server markup only. What the old page filtered
// and sorted in the browser the handler now sends already ordered: a derived view is a
// declared value, not an expression the compiler evaluates (DR-2). The rows are a list
// outside every island on purpose: a client-side list ships core's keyed reconciler, and
// a route with one is over N2's ceiling today (negative/list-island, the finding behind
// FORMA-188's notes); the toolbar reaches the table by id, as the old page's handlers did.
import { h, createShow, createSignal } from '@getforma/core';

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

export function ResultsToolbar(props: { failureCount: number; hasError: boolean; error?: string | null; noRows: boolean }) {
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
    </div>
  );
}
