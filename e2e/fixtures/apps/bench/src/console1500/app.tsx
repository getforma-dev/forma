import { mount, activateIslands } from '@getforma/core';
import { Tile } from '../shared/tile';
import { Console1500Page, defaultConsole1500 } from './page';

await activateIslands({ Tile });
mount(() => Console1500Page(defaultConsole1500), '#app');
