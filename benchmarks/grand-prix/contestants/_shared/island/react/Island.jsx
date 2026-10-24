import { useState, useLayoutEffect } from 'react';
import { markReady } from './island-ready.mjs';
export default function Island() {
 const [count, setCount] = useState(0); useLayoutEffect(markReady, []);
 return (<section id="gp-counter"><button id="gp-increment" type="button" onClick={() => setCount(value => value + 1)}>Increment</button><output id="gp-count">{count}</output></section>);
}
