// The compiler pairs this unary registry with native declared state metadata.
import { mount, activateIslands } from '@getforma/core';
import { Arrival, defaultArrival } from './arrival';
import { ArrivalPage } from './page';

if (document.querySelector('[data-forma-component="Arrival"]')) {
  activateIslands({ Arrival });
} else {
  mount(() => ArrivalPage(defaultArrival), '#app');
}
