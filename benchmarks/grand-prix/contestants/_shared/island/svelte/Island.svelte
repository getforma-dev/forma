<script>
  import { onMount } from 'svelte';
  import { markReady } from './island-ready.mjs';
  let count = $state(0);
  onMount(markReady);
</script>
<section id="gp-counter"><button id="gp-increment" type="button" onclick={() => count += 1}>Increment</button><output id="gp-count">{count}</output></section>
