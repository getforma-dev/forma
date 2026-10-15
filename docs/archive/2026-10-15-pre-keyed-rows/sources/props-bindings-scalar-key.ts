import { h, mount, createSignal, createList } from '@getforma/core';
export function Page(p: { text: string }) { return createList(() => p.text, r => r, r => h('p', null, r)); }
