import { activateIslands, mount } from '@getforma/core';
import { PageB, CounterB } from './page-b';
activateIslands({ CounterB });
mount(() => PageB({ count: 0, name: '', csrf: '', error: '' }), '#app');
