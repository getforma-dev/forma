// Measurement adapter: public API wrapper, never a change to router instrumentation.
import { createNativeAdapter, createRouter, type NavigationBootstrap, type RouteAdapter } from '@getforma/router';
export default function initialize(bootstrap: NavigationBootstrap) {
  let active: any;
  const original = createNativeAdapter(bootstrap);
  const adapter: RouteAdapter = { kind: 'native', connect(root) {
    const session = original.connect(root);
    return { ...session, async prepare(context) {
      const prepared = await session.prepare(context);
      if (active) active.preparedAt = performance.now();
      if ('redirect' in prepared) return prepared;
      return { ...prepared, validate() {
        if (active) active.finalValidationStart = performance.now();
        prepared.validate();
      }, commit() {
        const start = performance.now();
        try { prepared.commit(); } finally { if (active) { active.commitStart = start; active.commitEnd = performance.now(); } }
      }, activate() {
        if (active) active.activationStart = performance.now();
        return prepared.activate().then(() => { if (active) active.islandReadyAt = performance.now(); });
      } };
    } };
  } };
  const initial = JSON.parse(document.querySelector('script[data-forma-navigation]')!.textContent!);
  const router = createRouter({ root: document.querySelector<HTMLElement>('[data-forma-router-root]')!,
    base: '/native/', recoveryKey: bootstrap.build, adapter,
    routes: [{ id: 'shell', children: [{ id: 'a', path: 'a' }, { id: 'b', path: 'b' }] }],
    async checkContext(signal) { const response = await fetch('/__native/context', { signal, cache:'no-store' }); return response.ok && (await response.json()).context === initial.context; },
  });
  for (const method of ['pushState','replaceState'] as const) {
    const originalHistory = history[method].bind(history);
    history[method] = ((...args: Parameters<History['pushState']>) => {
      if (active) active.historyStart = performance.now();
      try { return originalHistory(...args); } finally { if (active) active.historyEnd = performance.now(); }
    }) as History[typeof method];
  }
  const documentIdentity = document;
  const ready = router.ready.then(() => ({ at: performance.now(), build: bootstrap.build }));
  const frame = ready.then(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
  (window as any).__bench = { ready, frame, build:bootstrap.build, async navigate(path: string) {
    await ready;
    const sample: any = { from: location.pathname, to: path, intent:performance.now() }; active = sample;
    const outcome = await router.navigate(path);
    if (outcome.kind !== 'committed') { active = undefined; throw Error(`Functional sample refused: ${outcome.kind}`); }
    await outcome.ready; sample.readyAt = performance.now();
    if (document !== documentIdentity || !document.querySelector('#layout-counter') || !document.querySelector('[id^="counter-"]')) throw Error('Native sample changed document or lost islands');
    sample.frameAt = await new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))));
    active = undefined;
    if (![sample.preparedAt,sample.finalValidationStart,sample.commitStart,sample.commitEnd,sample.activationStart,sample.islandReadyAt,sample.historyStart,sample.historyEnd].every(Number.isFinite)) throw Error('Missing preparation/commit timing marks');
    return { from:sample.from,to:sample.to,prepareMs:sample.preparedAt-sample.intent,
      preparedToHistoryMs:sample.historyStart-sample.preparedAt,historyWriteMs:sample.historyEnd-sample.historyStart,
      preparedToCommitMs:sample.finalValidationStart-sample.preparedAt,
      commitMs:sample.activationStart-sample.finalValidationStart,ownerCommitMs:sample.commitEnd-sample.commitStart,
      postOwnerBookkeepingMs:sample.activationStart-sample.commitEnd,islandReadyMs:sample.islandReadyAt-sample.intent,
      readyMs:sample.readyAt-sample.intent,frameMs:sample.frameAt-sample.intent };
  } };
}
