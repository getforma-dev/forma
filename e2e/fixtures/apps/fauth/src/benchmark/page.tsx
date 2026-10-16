import { h, createList } from '@getforma/core';
import { FilterBar, ResultsToolbar, type BenchmarkProps } from './table';

export function BenchmarkPage(props: BenchmarkProps) {
  return (
    <main class="bm-page">
      <h1 id="bm-title">Benchmark results</h1>
      <FilterBar query={props.query} sortColumn={props.sortColumn} rowCount={props.rowCount} />
      <ResultsToolbar failureCount={props.failureCount} hasError={props.hasError} error={props.error} noRows={props.noRows} />
      <table id="bm-table">
        <thead><tr><th>Name</th><th>Score</th><th>Verdict</th><th>Failure</th></tr></thead>
        <tbody>
          {createList(
            () => props.rows,
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
    </main>
  );
}
