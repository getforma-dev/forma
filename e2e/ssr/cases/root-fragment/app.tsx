// A page whose root is a JSX Fragment. Audit verification run 1 pinned its
// whole-page adoption; since 3.0.0 (FORMA-105, DR-6) a page with no island is
// static by contract: the server renders the Fragment's children, no script
// is served and the button is inert; client-rendered (/csr), the same page
// works.
import { h, Fragment, mount, createSignal } from '@getforma/core';

const [note, setNote] = createSignal('hello');

mount(() => (
  <>
    <span id="note">{() => note()}</span>
    <button id="go" onClick={() => setNote('bye')}>go</button>
  </>
), '#app');
