import { h, createSignal } from '@getforma/core';
export interface ShellProps { seed: number }
export function ShellCounter(props: { seed: number }) {
  const [count, setCount] = createSignal(props.seed);
  return <section aria-label="Persistent layout counter">
    <button id="layout-counter" type="button" onClick={() => setCount(count() + 1)}>Increment layout</button>
    <output id="layout-count">{() => count()}</output>
    <label>Persistent layout note<input id="layout-note" value="persistent"/></label>
  </section>;
}
export function Shell(props: ShellProps) {
  return <section id="native-layout">
    <header><h2>Native owner fixture</h2><ShellCounter seed={props.seed}/></header>
    <nav><a id="to-a" href="/native/a">Route A</a> <a id="to-b" href="/native/b">Route B</a></nav>
    <div data-forma-outlet="main"></div>
  </section>;
}
