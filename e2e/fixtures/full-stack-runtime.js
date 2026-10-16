// This fixture application's reviewed markup has no network, outside-DOM or
// navigation grants. Loading the bundle alone does not bind any directives.
const runtimeRoot = document.getElementById('test-runtime');
window.fullStackRuntimeHandle = window.FormaRuntime.mountMarkup(
  runtimeRoot,
  window.FormaRuntime.trustedHtml(runtimeRoot.innerHTML),
  { tier: 'reviewed' },
);
