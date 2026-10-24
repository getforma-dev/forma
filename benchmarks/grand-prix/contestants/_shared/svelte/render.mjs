import { render } from 'svelte/server';
import Page from './Page.svelte';
import { rows, summary } from './dataset.mjs';

const SHELL_HEAD = '<!doctype html><html><head><meta charset="utf-8"><title>Grand Prix</title></head><body>';
const SHELL_TAIL = '</body></html>';

export function renderPage(n) {
  const list = rows(n);
  const s = summary(list);
  return SHELL_HEAD + render(Page, { props: { list, s } }).body + SHELL_TAIL;
}
