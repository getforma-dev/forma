// The compiler pairs this unary registry with native declared state metadata.
// The 3.0.0 entry shape (FORMA-105, DR-6): the standalone mount selects the
// page and leaves the server-rendered route's browser product; the explicit
// Browser build (/csr) keeps it.
import { mount, activateIslands } from '@getforma/core';
import { Arrival, defaultArrival } from './arrival';
import { ArrivalPage } from './page';

activateIslands({ Arrival });
mount(() => ArrivalPage(defaultArrival), '#app');
