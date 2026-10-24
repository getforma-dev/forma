// Chrome may quantize a completed operation to zero. Preserve that observation;
// only geometric summaries use the existing score.mjs 0.1 ms resolution floor.
export function measuredDuration(ms, context) {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`${context}: invalid timing ${ms}`);
  return ms;
}

export function operationGeomean(means) {
  return Math.exp(means.reduce((sum, ms) => sum + Math.log(Math.max(measuredDuration(ms, 'operation mean'), 0.1)), 0) / means.length);
}
