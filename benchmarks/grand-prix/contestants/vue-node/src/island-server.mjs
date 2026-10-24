import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import Island from './Island.vue';
export async function renderIsland() { return '<div id="gp-root">' + await renderToString(createSSRApp(Island)) + '</div>'; }
