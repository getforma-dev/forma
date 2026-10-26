import { activateIslands, mount } from '@getforma/core';
import { ShellCounter } from './page-shell';
import { CounterB } from './page-b';
import { PlainB } from './plain-pages';
activateIslands({ ShellCounter, CounterB });
mount(() => PlainB({ seed: 0, count: 0, name: '', csrf: '', error: '' }), '#app');
