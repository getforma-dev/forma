// The entry, in the 3.0.0 shape (FORMA-105, DR-6): a standalone literal
// registry and a standalone top-level mount. The compiler selects ReportPage
// through the mount and removes it from the server-rendered route's browser
// product, which then only activates the registered islands; the chart,
// browserOnly(), is registered and activation calls its unary component with
// its validated props. The explicit Browser build of this same file (route
// /csr, Phase 1) keeps the mount and renders the page whole, chart included.
import { mount, activateIslands } from '@getforma/core';
import { Chart } from './chart';
import { ReportPage } from './page';

activateIslands({ Chart });
mount(() => ReportPage(), '#app');
