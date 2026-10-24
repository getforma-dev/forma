'use client';

import { useEffect, useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // This framework owns activation; no comparable native-call boundary is exposed.
    window.__gpIsland = { ready: true, readyAt: performance.now(), activationStart: null, activationMs: null };
  }, []);
  return <section id="gp-counter">
    <button id="gp-increment" onClick={() => setCount(value => value + 1)}>Increment</button>
    <output id="gp-count">{count}</output>
  </section>;
}
