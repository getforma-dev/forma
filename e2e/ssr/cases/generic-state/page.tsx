// Declared handler data; browser activation state adoption remains FORMA-103.
import { h, createSignal } from '@getforma/core';

type Props = { count: number };
export function Page(props: Props) {
  const [count, setCount] = createSignal(props.count);
  return (
    <main class="page">
      <p class="count">
        Count: <span id="count">{() => count()}</span>
      </p>
      <p class="actions">
        <button id="increment" onClick={() => setCount(count() + 1)}>Increment</button>
      </p>
    </main>
  );
}
