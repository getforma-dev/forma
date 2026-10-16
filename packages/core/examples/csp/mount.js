// The application owns this reviewed markup and explicitly starts its runtime.
// The existing class toggle acts on its own element and needs no grants.
const root = document.getElementById('csp-example');
window.cspExampleHandle = window.FormaRuntime.mountMarkup(
  root,
  window.FormaRuntime.trustedHtml(root.innerHTML),
  { tier: 'reviewed' },
);
