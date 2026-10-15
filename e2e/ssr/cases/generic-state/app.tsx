import { mount, activateIslands } from '@getforma/core';
import { Page, Counter } from './page';
if (document.querySelector('[data-forma-component="Counter"]')) {
  activateIslands({ Counter });
} else {
  mount(() => Page({ count: 0 }), '#app');
}
