import { hydrateRoot } from 'react-dom/client';
import Island from './Island.jsx';
window.__gpActivationStart=performance.now();
hydrateRoot(document.getElementById('gp-root'), <Island />);
