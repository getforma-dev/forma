import { h, Fragment, mount, createSignal } from '@getforma/core';

const [count, setCount] = createSignal(0);

// The SSR root is the tree returned by this `mount` callback.
//
// Everything written as literal JSX here is walked at build time into the
// `.ir` file and rendered to HTML by the Rust server (`npm run build:ssr`).
// Anything the compiler cannot walk statically — a component tag, a helper
// call that returns JSX, a dynamic tag — degrades to an island placeholder
// that only appears once JavaScript runs. Keep the shell literal and the
// dynamic parts inside `{() => ...}` bindings, as below.
mount(() => {
  return (
    <main class="page">
      <h1>{{PROJECT_NAME}}</h1>
      <p class="lede">
        Rust server, TypeScript frontend, no virtual DOM. This paragraph is in
        the HTML the server sends — view source to check.
      </p>
      <p class="count">
        Count: <span>{() => count()}</span>
      </p>
      <p class="actions">
        <button onClick={() => setCount(count() + 1)}>Increment</button>
        <button onClick={() => setCount(0)}>Reset</button>
      </p>
    </main>
  );
}, '#app');
