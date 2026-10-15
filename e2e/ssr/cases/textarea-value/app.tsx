// A textarea bound through its `value` prop. Audit verification run 2 (extra
// variant): the server writes a value="" attribute, which a textarea ignores,
// so it is empty before JavaScript; at the pinned core the binding never
// reaches the live control, even client-rendered.
//
// Since 3.0.0 (FORMA-105, DR-6) the form and its button are the island Editor,
// seeded from a declared prop; the page around it is static HTML.
import { h, mount, activateIslands, createSignal } from '@getforma/core';

function Editor(props: { text: string }) {
  const [text, setText] = createSignal(props.text);
  return (
    <section>
      <form id="f">
        <textarea id="ta" name="ta" value={() => text()}></textarea>
      </form>
      <button id="update" onClick={() => setText('updated')}>update</button>
    </section>
  );
}

function Page() {
  return (
    <main>
      <Editor text="hello" />
    </main>
  );
}

activateIslands({ Editor });
mount(() => Page(), '#app');
