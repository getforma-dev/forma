export function markReady() {
  const readyAt = performance.now();
  const activationStart = window.__gpActivationStart ?? null;
  window.__gpIsland = { ready: true, readyAt, activationStart,
    activationMs: activationStart === null ? null : readyAt - activationStart };
}
