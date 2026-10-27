import { h, mount, activateIslands, createSignal } from '@getforma/core';

type ShellProps = { count: number };
function LayoutCounter(props: ShellProps) {
  const [count, setCount] = createSignal(props.count);
  return <section aria-label="Persistent layout counter">
    <button id="layout-increment" onClick={() => setCount(count() + 1)}>Increment layout</button>
    <output id="layout-count">{() => count()}</output>
    <label>Layout note <input id="layout-note" value="This stays while navigating" /></label>
  </section>;
}
function Shell(props: ShellProps) {
  return <section class="page">
    <header><p>{{PROJECT_NAME}}</p><LayoutCounter count={props.count} /></header>
    <nav><a href="/">Home</a> <a href="/about">About</a></nav>
    <div data-forma-outlet="main"></div>
  </section>;
}
activateIslands({ LayoutCounter });
// Native compilation selects Shell and removes this mount from browser code.
mount(() => Shell({ count: 0 }), '#app');
