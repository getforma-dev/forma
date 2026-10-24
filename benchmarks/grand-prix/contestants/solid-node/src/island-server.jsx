import { renderToString, generateHydrationScript } from 'solid-js/web';
import Island from './Island.jsx';
export function renderIsland() { return generateHydrationScript() + '<div id="gp-root">' + renderToString(() => <Island />) + '</div>'; }
