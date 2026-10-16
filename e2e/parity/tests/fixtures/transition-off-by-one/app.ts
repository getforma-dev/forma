// A test fixture of the parity harness (FORMA-183): the P3 fixture with a setter that is wrong on
// purpose (it moves count to the next value plus one), so P3 must report the difference.
// The entry has the island-emitter fixtures' shape: the literal registry, then the page's mount,
// which the build removes from the browser entry (DR-6).
import { mount, activateIslands } from '@getforma/core';
import { Page } from './page';
import { Panel } from './island';

activateIslands({ Panel });
mount(() => Page(), '#app');
