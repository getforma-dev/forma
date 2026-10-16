/** Expression coverage is a separate floor: unrelated kills cannot mask its
 * survivors, missing/stale records or process failures with no failing test. */
export function expressionProbeFloor(corpus, results, floor) {
  if (!Number.isFinite(floor) || floor < 0 || floor > 100) throw new Error('invalid expression floor');
  const expected = corpus.filter(probe => probe.file.startsWith('src/expr/'));
  if (!expected.length) throw new Error('no expression probes selected');
  const seen = new Map();
  for (const result of results) {
    if (seen.has(result.id)) throw new Error(`duplicate probe result ${result.id}`);
    seen.set(result.id, result);
  }
  let caught = 0, survived = 0, equivalent = 0;
  for (const probe of expected) {
    const result = seen.get(probe.id);
    if (!result || result.file !== probe.file) throw new Error(`missing expression result ${probe.id}`);
    if (result.status === 'CAUGHT' && typeof result.killedBy === 'string' && result.killedBy.trim()) caught++;
    else if (result.status === 'SURVIVED') survived++;
    else if (result.status === 'EQUIVALENT' && probe.equivalent && result.equivalent === probe.equivalent) equivalent++;
    else throw new Error(`unqualified expression result ${probe.id}: ${result.status}`);
  }
  const scored = caught + survived;
  if (!scored) throw new Error('no scored expression probes');
  const rate = 100 * caught / scored;
  return { caught, survived, equivalent, total: expected.length, rate, floor, passed: rate >= floor };
}
