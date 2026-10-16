import { activateIslands, mount } from '@getforma/core';
import { KeyedRows, Page } from './page';

activateIslands({ KeyedRows });
mount(() => Page({ rows: [] }), '#app');
