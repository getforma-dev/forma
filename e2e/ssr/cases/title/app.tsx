// FORMA-139: the server render call owns the document title. The island
// updates an ordinary heading; the original component HTML title is retained
// as a BUILD-619 negative fixture under docs/archive/FORMA-139-e2e-title.
import { h, mount, activateIslands, createSignal } from '@getforma/core';

function Heading(props: { text: string }) {
  const [heading, setHeading] = createSignal(props.text);
  return (
    <section>
      <div id="title-host">
        <h1 id="heading">{() => heading()}</h1>
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
