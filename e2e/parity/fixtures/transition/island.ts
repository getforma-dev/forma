import { h, createSignal } from '@getforma/core';

interface PanelProps { title: string; count: number; note?: string }

// The island's own handler moves its signals to a next state's props. An `on*` handler is left to
// the browser by the compiler, so it may close over the setters (a registration before the return
// would be a pre-return mutation, BUILD-610). `onParitytransition` listens for `paritytransition`.
export function Panel(p: PanelProps) {
  const [title, setTitle] = createSignal(p.title);
  const [count, setCount] = createSignal(p.count);
  const [note, setNote] = createSignal(p.note ?? 'none');
  return h('section', {
    class: 'panel',
    title: () => title(),
    onParitytransition: (event: Event) => {
      const next = (event as CustomEvent<PanelProps>).detail;
      setTitle(next.title);
      setCount(next.count);
      setNote(next.note ?? 'none');
    },
  },
  h('h2', null, () => title()),
  h('p', null, () => count()),
  h('small', null, () => note()));
}

/** The P3 setter corpus.json names: the page passes its props to the island unchanged, so the next state's page props are the island's. */
export function parityTransition(next: PanelProps): void {
  for (const host of Array.from(document.querySelectorAll('section.panel'))) host.dispatchEvent(new CustomEvent('paritytransition', { detail: next }));
}
