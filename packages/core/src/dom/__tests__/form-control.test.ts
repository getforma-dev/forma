import { describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal, registerDisposer } from '../../reactive';
import { h } from '../element';
import { prepareAdoption } from '../adoption';

describe('live form properties', () => {
  it('initializes static and reactive selects after their options, before ref', () => {
    createRoot((dispose) => {
      const [value, setValue] = createSignal('yearly');
      const ref = vi.fn();
      const select = h('select', { value, ref: (el: HTMLSelectElement) => ref(el.value) },
        h('option', { value: 'monthly' }, 'Monthly'),
        h('optgroup', { label: 'Other' }, h('option', { value: 'yearly' }, 'Yearly')),
      ) as HTMLSelectElement;
      expect(select.value).toBe('yearly');
      expect(ref).toHaveBeenCalledWith('yearly');
      select.value = 'monthly';
      setValue('missing');
      expect(select.selectedIndex).toBe(-1);
      setValue('yearly');
      expect(select.value).toBe('yearly');
      expect((h('select', { value: 9 },
        h('option', { value: 1 }, 'January'), h('option', { value: 9 }, 'September'),
      ) as HTMLSelectElement).value).toBe('9');
      dispose();
    });
  });

  it('writes textarea live values, overriding initial children', () => {
    createRoot((dispose) => {
      const [value, setValue] = createSignal<string | null>('Saved notes');
      const textarea = h('textarea', { value }, 'Default notes') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Saved notes');
      textarea.value = 'Typed notes';
      setValue(null);
      expect(textarea.value).toBe('');
      setValue('Reloaded notes');
      expect(textarea.value).toBe('Reloaded notes');
      dispose();
    });
  });

  it('does not let an attribute cache skip a reset after user edits', () => {
    createRoot((dispose) => {
      const [state, setState] = createSignal({ value: '', checked: false });
      const input = h('input', { value: () => state().value }) as HTMLInputElement;
      const checkbox = h('input', { checked: () => state().checked, type: 'checkbox' }) as HTMLInputElement;
      input.value = 'User typed';
      checkbox.checked = true;
      setState({ value: '', checked: false });
      expect(input.value).toBe('');
      expect(checkbox.checked).toBe(false);
      setState({ value: 'Saved', checked: true });
      expect(input.value).toBe('Saved');
      expect(checkbox.checked).toBe(true);
      expect(checkbox.hasAttribute('checked')).toBe(true);
      dispose();
    });
  });

  it('avoids writing an unchanged input value and preserves the caret', () => {
    createRoot((dispose) => {
      const [state, setState] = createSignal({ value: 'hello' });
      const input = h('input', { value: () => state().value }) as HTMLInputElement;
      input.setSelectionRange(2, 2);
      setState({ value: 'hello' });
      expect(input.selectionStart).toBe(2);
      dispose();
    });
  });

  it('handles static values after input type and does not assign filenames', () => {
    expect((h('input', { value: 12.5, type: 'number' }) as HTMLInputElement).value).toBe('12.5');
    expect((h('input', { value: 'not-an-upload.png', type: 'file' }) as HTMLInputElement).value).toBe('');
    expect((h('input', { value: false }) as HTMLInputElement).value).toBe('false');
    expect(h('div', { value: 'attribute' }).getAttribute('value')).toBe('attribute');
  });

  it('supports multiple selected values and clearing a multiple select', () => {
    createRoot((dispose) => {
      const [value, setValue] = createSignal(['b', 'c']);
      const select = h('select', { value, multiple: true },
        ['a', 'b', 'c'].map((value) => h('option', { value }, value)),
      ) as HTMLSelectElement;
      expect(Array.from(select.selectedOptions, (option) => option.value)).toEqual(['b', 'c']);
      setValue([]);
      // happy-dom caches selectedOptions; inspect each option's actual state.
      expect(Array.from(select.options).filter((option) => option.selected)).toHaveLength(0);
      dispose();
    });
  });

  it('updates selected properties after the user changes an option', () => {
    createRoot((dispose) => {
      const [state, setState] = createSignal({ selected: false });
      const option = h('option', { selected: () => state().selected }, 'Choice') as HTMLOptionElement;
      option.selected = true;
      setState({ selected: false });
      expect(option.selected).toBe(false);
      dispose();
    });
  });

  it('uses live properties for adopted static and reactive form controls', () => {
    createRoot((dispose) => {
      const [state, setState] = createSignal({ value: 'Saved', checked: true });
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = '<section><input value="Saved"><input type="checkbox" checked><textarea>Saved notes</textarea></section>';
      const host = doc.body.firstElementChild!;
      const [input, checkbox] = Array.from(host.querySelectorAll('input'));
      const textarea = host.querySelector('textarea')!;
      const original = Array.from(host.childNodes);
      const plan = prepareAdoption(host, () => h('section', null,
        h('input', { value: () => state().value }),
        h('input', { type: 'checkbox', checked: () => state().checked }),
        h('textarea', { value: 'Saved notes' }),
      ));
      registerDisposer(plan.dispose);
      plan.commit();
      expect(Array.from(host.childNodes)).toEqual(original);
      expect(textarea.value).toBe('Saved notes');
      expect(input!.value).toBe('Saved');
      expect(checkbox!.checked).toBe(true);
      input!.value = 'Dirty';
      checkbox!.checked = false;
      setState({ value: 'Saved', checked: true });
      expect(input!.value).toBe('Saved');
      expect(checkbox!.checked).toBe(true);
      dispose();
    });
  });

  it('refuses an adopted select with missing options without constructing them', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<select></select>';
    const select = doc.body.firstElementChild as HTMLSelectElement;
    const observer = new MutationObserver(() => {});
    observer.observe(select, { subtree: true, attributes: true, childList: true, characterData: true });
    try {
      expect(() => prepareAdoption(select, () => h('select', { value: 'b' },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'),
      ))).toThrow('FORMA_E_HYDRATE_NODE');
      expect(select.childNodes).toHaveLength(0);
      expect(select.selectedIndex).toBe(-1);
      expect(observer.takeRecords()).toEqual([]);
    } finally { observer.disconnect(); }
  });
});
