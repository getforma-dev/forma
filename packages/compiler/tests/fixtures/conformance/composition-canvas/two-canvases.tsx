import { h, mount, activateIslands } from '@getforma/core';
import { Canvas, TwoCanvases } from './page';
await activateIslands({ Canvas });
mount(() => TwoCanvases({ cards: [], secondary: [] }), '#app');
