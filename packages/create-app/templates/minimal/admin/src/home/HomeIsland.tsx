import { createSignal, h, Fragment } from '@getforma/core';

const [count, setCount] = createSignal(0);

export function HomeIsland() {
  return (
    <div style="font-family: system-ui; padding: 2rem; text-align: center;">
      <h1>{{PROJECT_NAME}}</h1>
      <p>Count: {() => count()}</p>
      <button onClick={() => setCount(count() + 1)}>Increment</button>
      <button onClick={() => setCount(0)} style="margin-left: 8px;">Reset</button>
    </div>
  );
}
