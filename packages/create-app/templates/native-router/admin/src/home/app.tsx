import { h, mount, activateIslands, createSignal } from '@getforma/core';

type HomeProps = { count: number };
function Counter(props: HomeProps) {
  const [count, setCount] = createSignal(props.count);
  return <section aria-label="Home counter">
    <button id="home-increment" onClick={() => setCount(count() + 1)}>Increment home</button>
    <output id="home-count">{() => count()}</output>
  </section>;
}
function Home(props: HomeProps) {
  return <main><h1>Home</h1><p>This page is already present in the server HTML.</p><Counter count={props.count} /></main>;
}
activateIslands({ Counter });
mount(() => Home({ count: 0 }), '#app');
