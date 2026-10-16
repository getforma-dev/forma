import { mount, activateIslands } from '@getforma/core';
import { Tile } from '../shared/tile';
import { Doc10000Page, defaultDoc10000 } from './page';

activateIslands({ Tile });
mount(() => Doc10000Page(defaultDoc10000), '#app');
