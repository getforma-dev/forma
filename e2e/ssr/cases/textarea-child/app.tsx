// A textarea whose content is a reactive child. Audit verification run 2: the
// walker writes its f:t markers inside the textarea, where HTML parses them as
// text, so before JavaScript the value (and what a form submits) is
// `<!--f:t0-->hello<!--/f:t0-->`.
//
// Since 3.0.0 (FORMA-105, DR-6) the form and its button are the island Editor,
// seeded from a declared prop; the page around it is static HTML.
import { h, mount, activateIslands, createSignal } from '@getforma/core';

function Editor(props: { text: string }) {
  const [text, setText] = createSignal(props.text);
  return (
    <section>
      <form id="f">
        <textarea id="ta" name="ta">{() => text()}</textarea>
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
