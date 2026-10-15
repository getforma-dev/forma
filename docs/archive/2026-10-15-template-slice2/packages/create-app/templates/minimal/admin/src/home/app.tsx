import { h, Fragment, mount, createSignal } from '@getforma/core';

type HomeProps = { count: number };

// Slice 1 binds these declared props on the server. The whole-page mount is
// retained until the island/state-block migration; its browser default is 0.
function Home(props: HomeProps) {
  const [count, setCount] = createSignal(props.count);
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
}

mount(() => Home({ count: 0 }), '#app');
