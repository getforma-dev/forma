// Descriptive statistics only. Samples remain visible; no trimming or significance claims.
export function describe(values) {
  if (!Array.isArray(values) || !values.length) return null;
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Samples must be finite, nonnegative numbers; invalid samples cannot be dropped.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : null;
  const sd = variance === null ? null : Math.sqrt(variance);
  return {
    n, mean, median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    sd, min: sorted[0], max: sorted[n - 1], cv: sd === null || mean === 0 ? null : sd / mean,
  };
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function compareMeans(baseline, candidate, direction) {
  if (!baseline || !candidate || baseline.mean <= 0 || candidate.mean < 0) return null;
  const changePercent = 100 * (candidate.mean - baseline.mean) / baseline.mean;
  return {
    ratio: candidate.mean / baseline.mean,
    changePercent,
    improvementPercent: direction === 'higher' ? changePercent : -changePercent,
    interpretation: 'Descriptive difference of means; not a significance test or a causal attribution.',
  };
}
