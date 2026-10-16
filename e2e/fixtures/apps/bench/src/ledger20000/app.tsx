import { mount, activateIslands } from '@getforma/core';
import { Tile } from '../shared/tile';
import { Ledger20000Page, defaultLedger20000 } from './page';

activateIslands({ Tile });
mount(() => Ledger20000Page(defaultLedger20000), '#app');
