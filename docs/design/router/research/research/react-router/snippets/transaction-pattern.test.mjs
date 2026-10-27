import assert from "node:assert/strict";
import test from "node:test";
import { createLatestOnlyRunner } from "./transaction-pattern.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("slow A that ignores abort cannot overwrite a committed B", async () => {
  const first = deferred();
  const commits = [];
  let firstSignal;
  const runner = createLatestOnlyRunner({
    prepare: (target, { signal }) => {
      if (target === "A") { firstSignal = signal; return first.promise; }
      return "B data";
    },
    commit: (value, target) => commits.push({ value, target }),
  });
  const a = runner.run("A");
  assert.equal((await runner.run("B")).status, "committed");
  assert.equal(firstSignal.aborted, true);
  first.resolve("A data");
  assert.equal((await a).status, "superseded");
  assert.deepEqual(commits, [{ value: "B data", target: "B" }]);
});

test("a superseded rejection does not overwrite the current error UI", async () => {
  const first = deferred();
  const errors = [];
  const commits = [];
  const runner = createLatestOnlyRunner({
    prepare: target => target === "A" ? first.promise : "B data",
    commit: value => commits.push(value),
    onError: error => errors.push(error),
  });
  const a = runner.run("A");
  await runner.run("B");
  first.reject(new Error("late A failure"));
  assert.equal((await a).status, "superseded");
  assert.deepEqual(errors, []);
  assert.deepEqual(commits, ["B data"]);
});

test("disposing aborts pending work and prevents its late commit", async () => {
  const work = deferred();
  const commits = [];
  let signal;
  const runner = createLatestOnlyRunner({
    prepare: (_, options) => { signal = options.signal; return work.promise; },
    commit: value => commits.push(value),
  });
  const pending = runner.run("A");
  runner.dispose();
  assert.equal(signal.aborted, true);
  work.resolve("late data");
  assert.equal((await pending).status, "superseded");
  assert.deepEqual(commits, []);
  await assert.rejects(runner.run("B"), /disposed/);
});

test("a current preparation failure is delivered once without committing", async () => {
  const failure = new Error("current network failure");
  const errors = [];
  const runner = createLatestOnlyRunner({
    prepare: async () => { throw failure; },
    commit: () => assert.fail("failed preparation must not commit"),
    onError: (error, target) => errors.push({ error, target }),
  });
  const result = await runner.run("A");
  assert.equal(result.status, "failed");
  assert.equal(result.error, failure);
  assert.deepEqual(errors, [{ error: failure, target: "A" }]);
});
