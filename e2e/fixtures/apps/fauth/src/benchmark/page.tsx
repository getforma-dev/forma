import { h } from '@getforma/core';
import { FilterBar, ResultsToolbar, type BenchmarkProps } from './table';

export function BenchmarkPage(props: BenchmarkProps) {
  return (
    <main class="bm-page">
      <h1 id="bm-title">Benchmark results</h1>
      <FilterBar query={props.query} sortColumn={props.sortColumn} rowCount={props.rowCount} />
      <ResultsToolbar rows={props.rows} failureCount={props.failureCount} hasError={props.hasError} error={props.error} noRows={props.noRows} />
    </main>
  );
}
