import { hydrate } from 'solid-js/web';
import Island from './Island.jsx';
window.__gpActivationStart=performance.now();
hydrate(() => <Island />, document.getElementById('gp-root'));
