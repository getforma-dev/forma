export function installObservers() {
  window.__hostileExec = 0;
  window.__outsideReads = 0;
  window.__observeHostile = false;
  window.__policyEvents = [];
  addEventListener('securitypolicyviolation', event => window.__policyEvents.push({ directive: event.effectiveDirective, disposition: event.disposition, blockedURI: event.blockedURI }));
  const root = document.getElementById('root');
  for (const name of ['getAttribute', 'matches', 'querySelector', 'querySelectorAll']) {
    const original = Element.prototype[name];
    Element.prototype[name] = function (...args) {
      if (window.__observeHostile && typeof args[0] === 'string' && args[0].includes('data-secret')) {
        // Selector combinators can inspect ancestors even when the receiver is
        // inside the root, so count every secret-bearing selector submitted to
        // a native. Direct attribute reads count only outside the root.
        if (name === 'getAttribute' || name === 'matches') {
          if (!root.contains(this)) window.__outsideReads++;
        } else if (/[ >+~]/.test(args[0]) || !root.contains(this)) window.__outsideReads++;
      }
      return Reflect.apply(original, this, args);
    };
  }
  return { trustedTypes: Boolean(window.trustedTypes), runtime: typeof window.FormaRuntime?.mountMarkup === 'function' };
}

export async function observerControls() {
  const root = document.getElementById('root');
  const button = document.createElement('button');
  button.addEventListener('click', () => window.__hostileExec++);
  root.append(button); button.click(); button.remove();
  const executions = window.__hostileExec;
  window.__observeHostile = true;
  const secret = document.getElementById('outside').getAttribute('data-secret');
  window.__observeHostile = false;
  const outsideReads = window.__outsideReads;
  const response = await fetch('/api/observer-control');
  const unexpected = await fetch('/observer-unexpected');
  let trustedTypesRefused = false;
  try { root.innerHTML = '<p>must refuse an untrusted sink</p>'; } catch (error) { trustedTypesRefused = error instanceof TypeError; }
  window.__hostileExec = 0; window.__outsideReads = 0;
  return { executions, secret, outsideReads, response: response.status, unexpectedResponse: unexpected.status, trustedTypesRefused };
}
