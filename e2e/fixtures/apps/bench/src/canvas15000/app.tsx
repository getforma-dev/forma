import { mount, activateIslands } from '@getforma/core';
import { Tile } from '../shared/tile';
import { Canvas15000Page, defaultCanvas15000 } from './page';

activateIslands({ Tile });
mount(() => Canvas15000Page(defaultCanvas15000), '#app');
