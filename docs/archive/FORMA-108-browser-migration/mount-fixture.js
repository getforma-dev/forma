// This fixture application starts its own runtime explicitly.
const root = document.getElementById('fixture-mount');
window.fixtureHandle = window.FormaRuntime.mountMarkup(root, window.FormaRuntime.trustedHtml(root.innerHTML), { tier: 'reviewed' });
