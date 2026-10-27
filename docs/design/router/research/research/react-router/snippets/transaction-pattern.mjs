/**
 * Original study example, 2026-10-26. This is not React Router source or an API
 * compatibility implementation. See ../report.md sections 5, 6 and 13.
 *
 * Distills one contract: only the newest prepared result may commit. Aborting
 * work is cooperative, so identity must also be checked after awaiting it.
 * `prepare` must keep side effects out of the committed view; `commit` and
 * `onError` must be synchronous. They must not reenter this runner. A real router
 * needs history, redirects, boundaries, matching, cache policy and lifecycle UX.
 */
export function createLatestOnlyRunner({ prepare, commit, onError = () => {} }) {
  let generation = 0;
  let active;
  let disposed = false;

  return {
    async run(target) {
      if (disposed) throw new Error("Runner is disposed");
      const mine = ++generation;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const isCurrent = () => mine === generation && !controller.signal.aborted;

      let prepared;
      try {
        prepared = await prepare(target, { signal: controller.signal });
      } catch (error) {
        if (!isCurrent()) return { status: "superseded" };
        active = undefined;
        onError(error, target);
        return { status: "failed", error };
      }

      if (!isCurrent()) return { status: "superseded" };
      active = undefined;
      // No await between the currency check and the synchronous commit.
      commit(prepared, target);
      return { status: "committed", value: prepared };
    },
    dispose() {
      disposed = true;
      ++generation;
      active?.abort();
      active = undefined;
    },
  };
}
