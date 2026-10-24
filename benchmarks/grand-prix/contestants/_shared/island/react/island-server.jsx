import { renderToString } from 'react-dom/server';
import Island from './Island.jsx';
export function renderIsland() { return '<div id="gp-root">' + renderToString(<Island />) + '</div>'; }
