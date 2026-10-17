// A select bound to its second option. Audit verification run 3: the server
// writes value="b" on the select, which HTML ignores, and marks no option
// selected, so before JavaScript `a` is selected and submitted. At the pinned
// core the binding never reaches the live control either.
//
// Since 3.0.0 (FORMA-105, DR-6) the form and its button are the island Picker,
// seeded from a declared prop; the page around it is static HTML.
import { h, mount, activateIslands, createSignal } from '@getforma/core';

function Picker(props: { choice: string }) {
  const [choice, setChoice] = createSignal(props.choice);
  return (
    <section>
      <form id="f">
        <select id="choice" name="choice" value={() => choice()}>
          <option value="a">A</option>
          <option value="b">B</option>
          <option value="c">C</option>
        </select>
      </form>
      <button id="pick-c" onClick={() => setChoice('c')}>pick c</button>
    </section>
  );
}

function Page() {
  return (
    <main>
      <Picker choice="b" />
    </main>
  );
}

activateIslands({ Picker });
mount(() => Page(), '#app');
