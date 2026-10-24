/** Minimal structured Vitest evidence. Console text is never a kill oracle. */
import { writeFileSync } from 'node:fs';

const errorRecord = error => ({
  name: String(error.name ?? ''), code: String(error.code ?? ''),
  message: String(error.message ?? ''), stack: String(error.stack ?? ''),
  assertion: error.name === 'AssertionError' || error.code === 'ERR_ASSERTION'
    || (error.matcherResult !== null && typeof error.matcherResult === 'object'),
});

export default class ProbeReporter {
  ready = new Set();
  finished = new Set();
  // Open hooks by key, counted: +1 on start, -1 on end. Vitest reports each
  // update batch from the worker as it arrives and does not wait for the
  // previous batch, so one batch's events can be reported in between another's
  // and a hook's end can reach the reporter before its start (observed with
  // a start that ended one batch and its end that began the next). Pairing
  // by count is order-independent. A key still above zero when the run ends
  // started and never ended.
  hooks = new Map();
  processTimeout = false;
  cancellations = [];
  context;
  cancellationAttached = false;
  onInit(vitest) { this.context = vitest; }
  onTestModuleQueued() {
    // Vitest clears cancellation listeners after onTestRunStart. Module queue
    // events follow that reset and precede any test assertion/bail.
    if (!this.cancellationAttached) {
      this.context.onCancel(reason => { this.cancellations.push(reason); });
      this.cancellationAttached = true;
    }
  }
  onTestCaseReady(test) { this.ready.add(test.id); }
  onTestCaseResult(test) { this.finished.add(test.id); }
  onHookStart(hook) { this.#tally(hook, 1); }
  onHookEnd(hook) { this.#tally(hook, -1); }
  #tally(hook, delta) {
    const key = `${hook.entity.id}:${hook.name}`, open = (this.hooks.get(key) ?? 0) + delta;
    if (open === 0) this.hooks.delete(key); else this.hooks.set(key, open);
  }
  onProcessTimeout() { this.processTimeout = true; }
  onTestRunEnd(modules, unhandledErrors, reason) {
    const report = {
      schema: 1, reason, cancellations: this.cancellations, processTimeout: this.processTimeout,
      incompleteHooks: [...this.hooks].filter(([, open]) => open > 0).map(([key]) => key),
      unhandledErrors: unhandledErrors.map(errorRecord),
      modules: modules.map(module => ({
        file: module.moduleId, state: module.state(),
        errors: [module, ...module.children.allSuites()].flatMap(suite => suite.errors().map(errorRecord)),
        tests: [...module.children.allTests()].map(test => {
          const result = test.result(), diagnostic = test.diagnostic();
          return {
            id: test.id, name: test.fullName, state: result.state,
            started: this.ready.has(test.id), finished: this.finished.has(test.id),
            startTime: diagnostic?.startTime ?? null, duration: diagnostic?.duration ?? null,
            retryCount: diagnostic?.retryCount ?? 0,
            errors: (result.errors ?? []).map(errorRecord),
          };
        }),
      })),
    };
    if (!process.env.FORMA_PROBE_REPORT) throw new Error('missing mutation report path');
    writeFileSync(process.env.FORMA_PROBE_REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
}
