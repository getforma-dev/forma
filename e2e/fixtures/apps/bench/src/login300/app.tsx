import { mount, activateIslands } from '@getforma/core';
import { Tile } from '../shared/tile';
import { Login300Page, defaultLogin300 } from './page';

await activateIslands({ Tile });
mount(() => Login300Page(defaultLogin300), '#app');
