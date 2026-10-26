import { activateIslands, mount } from '@getforma/core';
import { PageA, CounterA } from './page-a';
activateIslands({ CounterA });
mount(() => PageA({ count: 0, name: '', csrf: '', error: '' }), '#app');
