import { h, mount, activateIslands, createSignal } from '@getforma/core';
export function Choice(p: { value: string; selected: boolean }) {
  return h('option', { value: p.value, selected: p.selected }, 'B'); // expect: BUILD-617
}
export function Picker() {
  const [value] = createSignal('b');
  return h('select', { value: () => value() }, h('option', { value: 'a' }, 'A'), Choice({ value: 'b', selected: false }));
}
export function Page() { return h('main', null, Picker()); }
activateIslands({ Picker, Choice });
mount(() => Page(), '#app');
