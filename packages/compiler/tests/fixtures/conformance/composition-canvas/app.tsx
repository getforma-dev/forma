import { h, mount, activateIslands } from '@getforma/core';
import { Canvas, Home } from './page';
await activateIslands({ Canvas });
mount(() => Home({ cards: [] }), '#app');
