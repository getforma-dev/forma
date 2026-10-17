/**
 * Form controls at adoption (FORMA-003, decision brief DR-5 and DR-7 (b), (c)).
 *
 * Public hydration never repairs the original server DOM or invents authority
 * to seed an edited reactive reader. Matching unedited bindings remain live;
 * literal initial values preserve edits. Compiler-owned writable control
 * positives are retained separately in adoption-control-bindings.test.ts.
 *
 * `textarea` and `title` are RCDATA elements: a hydration marker the server
 * writes inside one is text, not a comment. Servers on forma-ir 0.2.1 or later
 * (FORMA-002) write none; older ones do. happy-dom parses markers inside these
 * elements as comments, unlike a browser, so the older output is reproduced
 * here the way a browser parses it: one text node holding the marker text.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, createSignal } from 'forma/reactive';
import { onError } from '../../reactive/dev.js';
import { h } from '../element';
import { adoptInRoot } from './helpers/owned-adoption.js';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Put server HTML into a `data-forma-ssr` container and return it. */
function serve(html: string): HTMLElement {
  document.body.innerHTML = `<div id="app" data-forma-ssr>${html}</div>`;
  return document.getElementById('app')!;
}

/** What a browser parses from `<textarea><!--f:t0-->x<!--/f:t0--></textarea>`: the markers are text. */
const legacy = (text: string) => `<!--f:t0-->${text}<!--/f:t0-->`;

/** Record every DOM mutation under `root` from now on. */
function recordMutations(root: Node): () => MutationRecord[] {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => {
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records;
  };
}

/** Public hydration has no compiled signal/setter authority. */
function adoptMatching(build: () => unknown, app: HTMLElement): () => void {
  const report = vi.fn(), stop = onError(report);
  try {
    const dispose = adoptInRoot(build, app);
    expect(report).not.toHaveBeenCalled();
    return dispose;
  } finally { stop(); }
}

function refused(build: () => unknown, app: HTMLElement, code: string): () => void {
  const before = app.outerHTML, nodes = Array.from(app.querySelectorAll('*'));
  const done = recordMutations(app), report = vi.fn(), stop = onError(report);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const dispose = adoptInRoot(build, app);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code }), { source: 'hydration' });
    expect(app.outerHTML).toBe(before);
    expect(Array.from(app.querySelectorAll('*'))).toEqual(nodes);
    expect(done()).toEqual([]);
    return dispose;
  } finally { stop(); log.mockRestore(); }
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

describe('adoption keeps what the user entered before activation', () => {
  it('refuses an edited public reactive input and leaves its later updates inert', () => {
    const app = serve('<form><input id="t" name="t" value="Saved"><input id="s" value="Static"></form>');
    byId<HTMLInputElement>('t').value = 'Typed';
    byId<HTMLInputElement>('s').value = 'Typed too';
    const [value, setValue] = createSignal('Saved');

    refused(() => h('form', null,
      h('input', { id: 't', name: 't', value: () => value() }),
      h('input', { id: 's', value: 'Static' }),
    ), app, 'FORMA_E_HYDRATE_INPUT_TARGET');

    const input = byId<HTMLInputElement>('t');
    expect(input.value).toBe('Typed');
    expect(byId<HTMLInputElement>('s').value).toBe('Typed too');
    expect(new FormData(app.querySelector('form')!).get('t')).toBe('Typed');
    // No compiled authority exists to seed this public reader; refusal aborts it.
    setValue('Reset');
    expect(input.value).toBe('Typed');
    setValue('Again');
    expect(input.value).toBe('Typed');
    input.value = 'Typed later';
    setValue('Saved');
    expect(input.value).toBe('Typed later');
  });

  it('refuses edited public checkbox and radio readers without changing either choice', () => {
    const app = serve(
      '<div><input type="checkbox" id="c" checked>' +
      '<input type="radio" name="r" value="x" id="rx" checked><input type="radio" name="r" value="y" id="ry"></div>',
    );
    byId<HTMLInputElement>('c').checked = false;
    byId<HTMLInputElement>('ry').checked = true;
    byId<HTMLInputElement>('rx').checked = false;
    const [agree, setAgree] = createSignal(true);
    const [choice, setChoice] = createSignal('x');

    refused(() => h('div', null,
      h('input', { type: 'checkbox', id: 'c', checked: () => agree() }),
      h('input', { type: 'radio', name: 'r', value: 'x', id: 'rx', checked: () => choice() === 'x' }),
      h('input', { type: 'radio', name: 'r', value: 'y', id: 'ry', checked: () => choice() === 'y' }),
    ), app, 'FORMA_E_HYDRATE_INPUT_TARGET');

    const checks = () => ['c', 'rx', 'ry'].map((id) => byId<HTMLInputElement>(id).checked);
    expect(checks()).toEqual([false, false, true]);
    setAgree(false);
    setAgree(true);
    expect(checks()).toEqual([false, false, true]);
    setChoice('y');
    setChoice('x');
    expect(checks()).toEqual([false, false, true]);
  });

  it('refuses edited public selection and mismatched older defaults without repair', () => {
    for (const html of [
      // forma-ir 0.2.1 (FORMA-002): `selected` on the matching option.
      '<select id="s" name="s"><option value="a">A</option><option value="b" selected>B</option><option value="c">C</option></select>',
      // Older servers: a `value` attribute on the select, which selects nothing.
      '<select id="s" name="s" value="b"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>',
    ]) {
      const app = serve(`<form>${html}</form>`);
      byId<HTMLSelectElement>('s').value = 'c';
      const [choice, setChoice] = createSignal('b');

      const dispose = refused(() => h('form', null,
        h('select', { id: 's', name: 's', value: () => choice() },
          h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')),
      ), app, html.includes(' selected') ? 'FORMA_E_HYDRATE_INPUT_TARGET' : 'FORMA_E_HYDRATE_VALUE');

      const select = byId<HTMLSelectElement>('s');
      expect(select.value).toBe('c');
      expect(new FormData(app.querySelector('form')!).get('s')).toBe('c');
      setChoice('a');
      expect(select.value).toBe('c');
      setChoice('b');
      expect(select.value).toBe('c');
      dispose();
    }
  });

  it('refuses an untouched older select whose selected default disagrees', () => {
    const app = serve('<form><select id="s" name="s" value="b"><option value="a">A</option><option value="b">B</option></select></form>');
    // An older server's HTML selects the first option: the bug FORMA-002 fixes on the server.
    expect(byId<HTMLSelectElement>('s').value).toBe('a');

    refused(() => h('form', null,
      h('select', { id: 's', name: 's', value: () => 'b' },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
    ), app, 'FORMA_E_HYDRATE_VALUE');

    expect(byId<HTMLSelectElement>('s').value).toBe('a');
    expect(new FormData(app.querySelector('form')!).get('s')).toBe('a');
  });

  it("refuses edited public multiple-select and option readers without changing selection", () => {
    const app = serve(
      '<div><select id="m" multiple><option value="a" selected>A</option><option value="b">B</option><option value="c" selected>C</option></select>' +
      '<select id="o"><option value="x" id="ox" selected>X</option><option value="y" id="oy">Y</option></select></div>',
    );
    const multi = byId<HTMLSelectElement>('m');
    multi.options[1]!.selected = true;
    multi.options[2]!.selected = false;
    byId<HTMLSelectElement>('o').value = 'y';
    const [values, setValues] = createSignal(['a', 'c']);
    const [pick, setPick] = createSignal('x');

    refused(() => h('div', null,
      h('select', { id: 'm', multiple: true, value: () => values() },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')),
      h('select', { id: 'o' },
        h('option', { value: 'x', id: 'ox', selected: () => pick() === 'x' }, 'X'),
        h('option', { value: 'y', id: 'oy', selected: () => pick() === 'y' }, 'Y')),
    ), app, 'FORMA_E_HYDRATE_INPUT_TARGET');

    const chosen = () => Array.from(multi.options).filter((o) => o.selected).map((o) => o.value);
    expect(chosen()).toEqual(['a', 'b']);
    expect(byId<HTMLSelectElement>('o').value).toBe('y');
    setValues(['c']);
    expect(chosen()).toEqual(['a', 'b']);
    setPick('y');
    setPick('x');
    expect(byId<HTMLSelectElement>('o').value).toBe('y');
  });

  it("refuses edited public textarea readers and older mismatched defaults", () => {
    for (const html of ['<textarea id="n" value="Saved"></textarea>', '<textarea id="n">Saved</textarea>']) {
      const app = serve(html);
      byId<HTMLTextAreaElement>('n').value = 'Typed';
      const [notes, setNotes] = createSignal('Saved');

      const dispose = refused(() => h('textarea', { id: 'n', value: () => notes() }), app, html.includes(' value=') ? 'FORMA_E_HYDRATE_VALUE' : 'FORMA_E_HYDRATE_INPUT_TARGET');

      const textarea = byId<HTMLTextAreaElement>('n');
      expect(textarea.value).toBe('Typed');
      setNotes('Cleared');
      expect(textarea.value).toBe('Typed');
      setNotes('Saved');
      expect(textarea.value).toBe('Typed');
      dispose();
    }
  });
});

describe('adoption writes nothing the server already rendered', () => {
  it('adoption writes nothing when the server and the client agree', async () => {
    const app = serve(
      '<form>' +
      '<input id="t" value="Saved"><input type="checkbox" id="c" checked>' +
      '<select id="s"><option value="a">A</option><option value="b" selected>B</option></select>' +
      '<textarea id="v">Saved notes</textarea><textarea id="ta">hello</textarea>' +
      '<div><title id="tt">Page</title></div>' +
      '</form>',
    );
    const done = recordMutations(app);
    const [value, setValue] = createSignal('Saved');

    adoptMatching(() => h('form', null,
      h('input', { id: 't', value: () => value() }),
      h('input', { type: 'checkbox', id: 'c', checked: () => true }),
      h('select', { id: 's', value: () => 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
      h('textarea', { id: 'v', value: () => 'Saved notes' }),
      h('textarea', { id: 'ta' }, () => 'hello'),
      h('div', null, h('title', { id: 'tt' }, () => 'Page')),
    ), app);
    await Promise.resolve();

    // Success is internal; even the legacy SSR attribute stays untouched.
    const records = done();
    expect(records.map((r) => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`)).toEqual([]);
    expect(byId<HTMLInputElement>('t').value).toBe('Saved');
    expect(byId<HTMLSelectElement>('s').value).toBe('b');
    expect(byId<HTMLTextAreaElement>('ta').value).toBe('hello');

    // The observer sees binding writes: a later update is one.
    const again = recordMutations(app);
    setValue('Changed');
    await Promise.resolve();
    expect(again().some((r) => r.type === 'attributes' && (r.target as Element).id === 't')).toBe(true);
  });

  it('refuses mismatched control defaults without repairing any sibling', () => {
    const app = serve('<div><input id="t" value="Old"><input type="checkbox" id="c"><textarea id="ta">old</textarea><div><title id="tt">Old</title></div></div>');

    refused(() => h('div', null,
      h('input', { id: 't', value: () => 'New' }),
      h('input', { type: 'checkbox', id: 'c', checked: () => true }),
      h('textarea', { id: 'ta' }, () => 'new'),
      h('div', null, h('title', { id: 'tt' }, () => 'New')),
    ), app, 'FORMA_E_HYDRATE_VALUE');

    expect(byId<HTMLInputElement>('t').value).toBe('Old');
    expect(byId<HTMLInputElement>('t').getAttribute('value')).toBe('Old');
    expect(byId<HTMLInputElement>('c').checked).toBe(false);
    expect(byId<HTMLTextAreaElement>('ta').value).toBe('old');
    expect(byId('tt').textContent).toBe('Old');
  });
});

describe('textarea and title text is bound by the element', () => {
  it('binds a marker-free textarea by the element and writes nothing when it agrees', async () => {
    const app = serve('<form><textarea id="ta" name="ta">hello</textarea></form>');
    const done = recordMutations(app.querySelector('form')!);
    const [text, setText] = createSignal('hello');

    adoptMatching(() => h('form', null, h('textarea', { id: 'ta', name: 'ta' }, () => text())), app);
    await Promise.resolve();

    const textarea = byId<HTMLTextAreaElement>('ta');
    expect(done()).toEqual([]);
    expect(textarea.value).toBe('hello');
    setText('updated');
    expect(textarea.value).toBe('updated');
    expect(new FormData(app.querySelector('form')!).get('ta')).toBe('updated');
    textarea.value = 'typed';
    setText('reset');
    expect(textarea.value).toBe('reset');
    expect(textarea.defaultValue).toBe('reset');
  });

  it('refuses older textarea marker text without stripping or binding it', () => {
    const app = serve('<form><textarea id="ta" name="ta"></textarea></form>');
    const textarea = byId<HTMLTextAreaElement>('ta');
    textarea.textContent = legacy('hello');
    // The defect FORMA-002 fixes on the server: the marker text is the value.
    expect(textarea.value).toBe(legacy('hello'));
    const [text, setText] = createSignal('hello');

    refused(() => h('form', null, h('textarea', { id: 'ta', name: 'ta' }, () => text())), app, 'FORMA_E_HYDRATE_VALUE');

    expect(textarea.value).toBe(legacy('hello'));
    expect(textarea.defaultValue).toBe(legacy('hello'));
    expect(new FormData(app.querySelector('form')!).get('ta')).toBe(legacy('hello'));
    setText('updated');
    expect(textarea.value).toBe(legacy('hello'));
    setText('hello');
    expect(textarea.value).toBe(legacy('hello'));
  });

  it('refuses a marker-carrying textarea while preserving its edited live value', () => {
    const app = serve('<textarea id="ta"></textarea>');
    const textarea = byId<HTMLTextAreaElement>('ta');
    textarea.textContent = legacy('hello');
    textarea.value = 'typed';
    const [text, setText] = createSignal('hello');

    refused(() => h('textarea', { id: 'ta' }, () => text()), app, 'FORMA_E_HYDRATE_VALUE');

    expect(textarea.value).toBe('typed');
    // A mismatched original default remains intact on refusal.
    expect(textarea.defaultValue).toBe(legacy('hello'));
    setText('updated');
    expect(textarea.value).toBe('typed');
    expect(textarea.defaultValue).toBe(legacy('hello'));
  });

  it('keeps server text that only looks like marker text, edited or not, without a write', async () => {
    // A marker-free server whose text documents Forma's own markers.
    const literal = 'Docs say <!--f:t0--> is a marker';
    const app = serve('<div><textarea id="edited"></textarea><textarea id="untouched"></textarea></div>');
    const edited = byId<HTMLTextAreaElement>('edited');
    const untouched = byId<HTMLTextAreaElement>('untouched');
    edited.textContent = literal;
    untouched.textContent = literal;
    edited.value = 'typed';
    const done = recordMutations(app.firstElementChild!);

    adoptMatching(() => h('div', null,
      h('textarea', { id: 'edited' }, literal),
      h('textarea', { id: 'untouched' }, literal),
    ), app);
    await Promise.resolve();

    expect(done()).toEqual([]);
    expect(edited.value).toBe('typed');
    expect(edited.defaultValue).toBe(literal);
    expect(untouched.value).toBe(literal);
  });

  it("refuses older markers around literal marker text and preserves both edited defaults", () => {
    const literal = 'Docs say <!--f:t0--> is a marker';
    const app = serve('<div><textarea id="legacy"></textarea><textarea id="disagree"></textarea></div>');
    const legacyArea = byId<HTMLTextAreaElement>('legacy');
    const disagree = byId<HTMLTextAreaElement>('disagree');
    // An older server escapes the user's `<!--`, which parses to the same text as a marker.
    legacyArea.textContent = legacy(literal);
    disagree.textContent = 'Server text';
    legacyArea.value = 'typed';
    disagree.value = 'typed too';

    refused(() => h('div', null,
      h('textarea', { id: 'legacy' }, () => literal),
      h('textarea', { id: 'disagree' }, () => 'Client text'),
    ), app, 'FORMA_E_HYDRATE_VALUE');

    expect(legacyArea.value).toBe('typed');
    expect(legacyArea.defaultValue).toBe(legacy(literal));
    expect(disagree.value).toBe('typed too');
    expect(disagree.defaultValue).toBe('Server text');
  });

  it('refuses an older zero-width-space marker value without clearing it', () => {
    const app = serve('<textarea id="ta"></textarea>');
    const textarea = byId<HTMLTextAreaElement>('ta');
    textarea.textContent = legacy('\u200B');
    textarea.value = 'typed';
    const [text, setText] = createSignal('');

    refused(() => h('textarea', { id: 'ta' }, () => text()), app, 'FORMA_E_HYDRATE_VALUE');

    expect(textarea.value).toBe('typed');
    expect(textarea.defaultValue).toBe(legacy('\u200B'));
    setText('later');
    expect(textarea.defaultValue).toBe(legacy('\u200B'));
    setText('');
    expect(textarea.defaultValue).toBe(legacy('\u200B'));
  });

  it('binds matching composed textarea text and refuses older marker-bearing output', () => {
    for (const serverText of ['Note: v', `Note: ${legacy('v')}`]) {
      const app = serve('<textarea id="ta"></textarea>');
      byId<HTMLTextAreaElement>('ta').textContent = serverText;
      const [x, setX] = createSignal('v');

      const adopt = serverText === 'Note: v' ? adoptMatching : (build: () => unknown, host: HTMLElement) => refused(build, host, 'FORMA_E_HYDRATE_VALUE');
      const dispose = adopt(() => h('textarea', { id: 'ta' }, 'Note: ', () => x()), app);

      const textarea = byId<HTMLTextAreaElement>('ta');
      expect(textarea.value).toBe(serverText);
      expect(textarea.childNodes).toHaveLength(1);
      setX('w');
      expect(textarea.value).toBe(serverText === 'Note: v' ? 'Note: w' : serverText);
      setX('v');
      expect(textarea.value).toBe(serverText);
      dispose();
    }
  });

  it("binds matching title text by the element and refuses older marker-bearing output", () => {
    for (const serverText of ['Docs: Page', `Docs: ${legacy('Page')}`]) {
      const app = serve('<div><title id="tt"></title></div>');
      byId('tt').textContent = serverText;
      const [title, setTitle] = createSignal('Page');

      const adopt = serverText === 'Docs: Page' ? adoptMatching : (build: () => unknown, host: HTMLElement) => refused(build, host, 'FORMA_E_HYDRATE_VALUE');
      const dispose = adopt(() => h('div', null, h('title', { id: 'tt' }, 'Docs: ', () => title())), app);

      const el = byId('tt');
      expect(el.textContent).toBe(serverText);
      setTitle('Next');
      expect(el.textContent).toBe(serverText === 'Docs: Page' ? 'Docs: Next' : serverText);
      setTitle('Page');
      expect(el.textContent).toBe(serverText);
      expect(el.childNodes).toHaveLength(1);
      dispose();
    }
  });

  it("after the user types, a textarea's reactive text controls its live and default values, client-rendered and adopted alike", () => {
    // Client-rendered (Phase 1)
    createRoot((dispose) => {
      const [text, setText] = createSignal('Hello Ann');
      const textarea = h('textarea', null, () => text()) as HTMLTextAreaElement;
      expect(textarea.value).toBe('Hello Ann');
      textarea.value = 'Hello Ann, my long message';
      setText('Hello Bob');
      expect(textarea.value).toBe('Hello Bob');
      expect(textarea.defaultValue).toBe('Hello Bob');
      setText('Hello Cy');
      expect(textarea.defaultValue).toBe('Hello Cy');
      expect(textarea.value).toBe('Hello Cy');
      dispose();
    });

    // Server-rendered and adopted (Phase 2)
    const app = serve('<textarea id="ta">Hello Ann</textarea>');
    const [text, setText] = createSignal('Hello Ann');
    adoptMatching(() => h('textarea', { id: 'ta' }, () => text()), app);
    const textarea = byId<HTMLTextAreaElement>('ta');
    setText('Hello Bo');
    // Untouched, the value follows its default.
    expect(textarea.value).toBe('Hello Bo');
    textarea.value = 'Hello Bo, my long message';
    setText('Hello Bob');
    expect(textarea.value).toBe('Hello Bob');
    expect(textarea.defaultValue).toBe('Hello Bob');
  });
});

describe('option values', () => {
  it('an option bound to undefined or null submits its text, client-rendered and adopted', () => {
    // Client-rendered
    createRoot((dispose) => {
      const [beta, setBeta] = createSignal<string | null>(null);
      const form = h('form', null,
        h('select', { name: 'c' },
          h('option', { value: undefined }, 'Alpha'),
          h('option', { value: () => beta() }, 'Beta')),
      ) as HTMLFormElement;
      const select = form.querySelector('select')!;
      expect([...new FormData(form)]).toEqual([['c', 'Alpha']]);
      expect(select.options[0]!.hasAttribute('value')).toBe(false);
      select.selectedIndex = 1;
      expect([...new FormData(form)]).toEqual([['c', 'Beta']]);
      setBeta('b');
      expect([...new FormData(form)]).toEqual([['c', 'b']]);
      setBeta(null);
      expect([...new FormData(form)]).toEqual([['c', 'Beta']]);
      dispose();
    });

    // Adopted: the server wrote no value attribute for a nullish value.
    const app = serve('<form><select name="s"><option>Alpha</option><option>Beta</option></select></form>');
    adoptMatching(() => h('form', null,
      h('select', { name: 's' },
        h('option', { value: () => undefined }, 'Alpha'),
        h('option', { value: () => null }, 'Beta')),
    ), app);
    const form = app.querySelector('form')!;
    expect([...new FormData(form)]).toEqual([['s', 'Alpha']]);
    expect(form.querySelector('option')!.hasAttribute('value')).toBe(false);
  });
});
