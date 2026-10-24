import { render } from 'preact-render-to-string';
import Island from './Island.jsx';
export function renderIsland() { return '<div id="gp-root">' + render(<Island />) + '</div>'; }
