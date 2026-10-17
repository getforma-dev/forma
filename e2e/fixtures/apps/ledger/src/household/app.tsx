// The 3.0.0 entry shape (FORMA-105, DR-6): a literal registry and a top-level mount.
import { mount, activateIslands } from '@getforma/core';
import { HouseholdArrival, defaultArrival } from './arrival';
import { HouseholdPage } from './page';

await activateIslands({ HouseholdArrival });
mount(() => HouseholdPage(defaultArrival), '#app');
