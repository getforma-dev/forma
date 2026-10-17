// The parity harness's P3 fixture (FORMA-183): one island seeded from declared page props, whose
// module exports the setter the harness calls to move it to a next state (corpus.json names it).
// The entry has the island-emitter fixtures' shape: the literal registry, then the page's mount,
// which the build removes from the browser entry (DR-6).
import { mount, activateIslands } from '@getforma/core';
import { Page } from './page';
import { Panel } from './island';

activateIslands({ Panel });
mount(() => Page(), '#app');
