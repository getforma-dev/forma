// The entry, after Ledger's household entry: on a server-rendered page the
// arrival island is activated through a literal registry whose wrapper seeds
// the signals from the props first; with no island (development, Phase 1) the
// page is mounted whole. Then the workspace load starts.
import { h, mount, activateIslands } from '@getforma/core';
import { Arrival, loadWorkspace, seedArrival, defaultArrival } from './arrival';
import { ArrivalPage } from './page';

if (document.querySelector('[data-forma-component="Arrival"]')) {
  // Keep registration literal so the compiler emits the real named island.
  activateIslands({
    Arrival: (_root: HTMLElement, props: Record<string, unknown> | null) => {
      return Arrival(seedArrival(props));
    },
  });
} else {
  mount(() => ArrivalPage(defaultArrival), '#app');
}

void loadWorkspace();
