import { render } from 'svelte/server';
import Island from './Island.svelte';
export function renderIsland() { return '<div id="gp-root">' + render(Island).body + '</div>'; }
