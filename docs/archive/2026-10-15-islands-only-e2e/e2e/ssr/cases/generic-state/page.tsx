// Handler props are delivered through the native island state channel.
import { h, createSignal } from '@getforma/core';

type Props = { count: number };
export function Counter(props: Props) {
  const [count, setCount] = createSignal(props.count);
  return (
    <section class="counter">
      <p class="count">
        Count: <span id="count">{() => count()}</span>
      </p>
      <p class="actions">
        <button id="increment" onClick={() => setCount(count() + 1)}>Increment</button>
      </p>
    </section>
  );
}

export function Page(props: Props) {
  return <main class="page">{Counter(props)}</main>;
}
