import { createSSRApp } from 'vue';
import Island from './Island.vue';
window.__gpActivationStart=performance.now();
createSSRApp(Island).mount(document.getElementById('gp-root'));
