import { activateIslands, mount } from '@getforma/core';
import { Shell, ShellCounter } from './page-shell';
activateIslands({ ShellCounter });
mount(() => Shell({ seed: 0 }), '#app');
