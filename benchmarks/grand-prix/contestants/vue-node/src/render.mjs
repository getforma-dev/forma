import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import Page from './Page.vue';
import { rows, summary } from './dataset.mjs';

const SHELL_HEAD = '<!doctype html><html><head><meta charset="utf-8"><title>Grand Prix</title></head><body>';
const SHELL_TAIL = '</body></html>';

export async function renderPage(n) {
  const list = rows(n);
  const s = summary(list);
  const app = createSSRApp(Page, { list, s });
  return SHELL_HEAD + (await renderToString(app)) + SHELL_TAIL;
}
