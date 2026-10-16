import { mount, activateIslands } from '@getforma/core';
import { FeedStatus, LiveEcho, defaultCheck } from './screen';
import { CheckPage } from './page';

activateIslands({ FeedStatus, LiveEcho });
mount(() => CheckPage(defaultCheck), '#app');
