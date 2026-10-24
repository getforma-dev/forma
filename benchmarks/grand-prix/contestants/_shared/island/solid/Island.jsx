import { createSignal, onMount } from 'solid-js';
import { markReady } from './island-ready.mjs';
export default function Island() {
 const [count, setCount] = createSignal(0); onMount(markReady);
 return (<section id="gp-counter"><button id="gp-increment" type="button" onClick={() => setCount(count() + 1)}>Increment</button><output id="gp-count">{count()}</output></section>);
}
