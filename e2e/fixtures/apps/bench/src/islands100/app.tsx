import { mount, activateIslands } from '@getforma/core';
import { Tile } from '../shared/tile';
import { Islands100Page, defaultIslands100 } from './page';

activateIslands({ Tile });
mount(() => Islands100Page(defaultIslands100), '#app');
