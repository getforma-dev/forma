import { h, mount } from '@getforma/core';

function About() {
  return <main><h1>About</h1><p>The layout counter and note retain their state across these routes.</p><p>This leaf has no islands. The shared navigation group still loads its bootstrap.</p></main>;
}
mount(() => About(), '#app');
