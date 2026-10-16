import { mount, activateIslands } from '@getforma/core';
import { FilterBar, ResultsToolbar, defaultBenchmark } from './table';
import { BenchmarkPage } from './page';

await activateIslands({ FilterBar, ResultsToolbar });
mount(() => BenchmarkPage(defaultBenchmark), '#app');
