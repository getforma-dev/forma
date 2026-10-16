import { activateIslands, mount } from '@getforma/core';
import { IndexedRows, Page } from './page';
function browserRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, label: `Label ${index}` }));
}
activateIslands({ IndexedRows });
mount(() => Page({ small: browserRows(200), large: browserRows(2000) }), '#app');
