import { hydrate } from 'svelte';
import Island from './Island.svelte';
window.__gpActivationStart=performance.now();
hydrate(Island, { target: document.getElementById('gp-root'), recover:false });
