import { readFile } from 'node:fs/promises';
import { renderPage } from './render.mjs';
const rendererPath = './island-server.mjs';
export async function islandHtml() {
  const { renderIsland } = await import(/* @vite-ignore */ new URL(rendererPath, import.meta.url).href);
  // The table remains the original server-rendered HTML outside the native
  // hydration root. Only the independently server-rendered counter activates.
  const dashboard = await renderPage(100);
  const counter = await renderIsland();
  return dashboard.replace('<table', counter + '<table')
    .replace('</body>', '<script type="module" src="/island-client.js"></script></body>');
}
export function islandJavaScript() { return readFile(new URL('./island-client.js', import.meta.url)); }
