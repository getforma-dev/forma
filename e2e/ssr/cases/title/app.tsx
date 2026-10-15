// A reactive <title> element inside a component. Audit verification run 2: its
// text before JavaScript is the marker text. It never becomes document.title,
// because render_page writes the page's own <title> in <head> first.
//
// Since 3.0.0 (FORMA-105, DR-6) a server-rendered page activates only its
// islands, so the reactive part is the island Heading, seeded from a declared
// prop; the page around it is static HTML.
import { h, mount, activateIslands, createSignal } from '@getforma/core';

function Heading(props: { text: string }) {
  const [heading, setHeading] = createSignal(props.text);
  return (
    <section>
      <div id="title-host">
        <title id="tt">{() => heading()}</title>
      </div>
      <button id="update" onClick={() => setHeading('updated')}>update</button>
    </section>
  );
}

function Page() {
  return (
    <main>
      <Heading text="hello" />
    </main>
  );
}

activateIslands({ Heading });
mount(() => Page(), '#app');
