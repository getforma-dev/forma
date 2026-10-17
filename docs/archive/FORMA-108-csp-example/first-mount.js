// The application owns this reviewed markup and explicitly starts its runtime.
// DOM access is needed only by the existing $el.classList.toggle handler.
const root = document.getElementById('csp-example');
window.cspExampleHandle = window.FormaRuntime.mountMarkup(
  root,
  window.FormaRuntime.trustedHtml(root.innerHTML),
  { tier: 'reviewed', grants: { dom: true } },
);
