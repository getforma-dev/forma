// Temporary diagnostic branch only. Interval overlap is not CPU attribution.
import assert from 'node:assert/strict';

// Serialized into the existing served boot module; no product source is changed.
export function createTimingCapture() {
  const tasks = [];
  const take = entries => { for (const entry of entries) tasks.push(entry.toJSON()); };
  const observer = new PerformanceObserver(list => take(list.getEntries()));
  observer.observe({type: 'longtask', buffered: true});
  return {finish(times) {
    take(observer.takeRecords()); observer.disconnect();
    return {...times, longTasks: tasks};
  }};
}

export async function decoderTimingControl(mode) {
  const capture = createTimingCapture();
  const startTime = performance.now();
  if (mode === 'busy') while (performance.now() - startTime < 110) { /* intentional control */ }
  const returnTime = performance.now();
  if (mode === 'timer') await new Promise(resolve => setTimeout(resolve, 80));
  const entryTime = performance.now();
  await new Promise(resolve => setTimeout(resolve, 0));
  return {mode, elapsedMs: entryTime - startTime, timing: capture.finish({startTime, returnTime, entryTime,
    activationCompleteTime: entryTime, validationStartTime: entryTime, validationEndTime: entryTime, endTime: performance.now()})};
}

const overlap = (start, end, a, b) => Math.max(0, Math.min(end, b) - Math.max(start, a));
export function summarizeTiming(timing, elapsedMs) {
  const {startTime, returnTime, entryTime, activationCompleteTime, validationStartTime, validationEndTime, endTime, longTasks} = timing;
  for (const time of [startTime, returnTime, activationCompleteTime, validationStartTime, validationEndTime, endTime]) assert(Number.isFinite(time) && time >= 0);
  assert(startTime <= returnTime && returnTime <= activationCompleteTime && activationCompleteTime <= validationStartTime && validationStartTime <= validationEndTime && validationEndTime <= endTime);
  if (entryTime === null) assert.equal(elapsedMs, null);
  else {
    assert(Number.isFinite(entryTime) && entryTime >= returnTime && entryTime <= activationCompleteTime);
    assert.equal(entryTime - startTime, elapsedMs, 'original public entry metric changed');
  }
  assert(Array.isArray(longTasks));
  const phases = {synchronousPublicCall: [startTime, returnTime], returnToEntry: [returnTime, entryTime ?? returnTime],
    entryToActivationComplete: [entryTime ?? activationCompleteTime, activationCompleteTime], postEntryValidation: [validationStartTime, validationEndTime]};
  return {publicEntryMs: elapsedMs, synchronousReturnMs: returnTime - startTime, returnToEntryMs: entryTime === null ? null : entryTime - returnTime,
    longTasks: longTasks.map(task => {
      assert.equal(task.entryType, 'longtask'); assert(Number.isFinite(task.startTime) && task.startTime >= 0); assert(Number.isFinite(task.duration) && task.duration > 0);
      const end = task.startTime + task.duration;
      return {raw: task, endTime: end, overlapMs: Object.fromEntries(Object.entries(phases).map(([name, [a, b]]) => [name, overlap(task.startTime, end, a, b)]))};
    })};
}
export function validateTimingControls(controls) {
  assert.deepEqual(controls.map(c => c.mode), ['busy', 'timer']);
  const [busy, timer] = controls.map(c => summarizeTiming(c.timing, c.elapsedMs));
  assert(busy.synchronousReturnMs >= 109, 'busy control did not block for 110ms');
  assert(busy.longTasks.some(t => t.raw.duration >= 109 && t.overlapMs.synchronousPublicCall >= 109), 'busy control long task was not observed');
  assert(timer.synchronousReturnMs < 50 && timer.returnToEntryMs >= 79, 'timer control did not isolate waiting');
  assert(timer.longTasks.every(t => t.overlapMs.synchronousPublicCall === 0 && t.overlapMs.returnToEntry === 0), 'timer control overlapped an actual long task');
  return {busy, timer};
}
