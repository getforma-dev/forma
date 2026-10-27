import { activateIslands, mount } from '@getforma/core';
import { ShellCounter } from './page-shell';
import { CounterA } from './page-a';
import { PlainA } from './plain-pages';
activateIslands({ ShellCounter, CounterA });
mount(() => PlainA({ seed: 0, count: 0, name: '', csrf: '', error: '' }), '#app');
