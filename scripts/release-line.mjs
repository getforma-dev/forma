// Version identity only. This never grants milestone, audit or soak readiness.
import assert from 'node:assert/strict';

export function releaseLine(tag) {
  assert.equal(typeof tag, 'string', 'unknown release qualification milestone');
  const match = /^v((?:[3-9]|[1-9]\d+)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(alpha|beta|rc)\.([1-9]\d*))?$/.exec(tag ?? '');
  assert(match && match[0] === tag, 'unknown release qualification milestone');
  return { version: tag.slice(1), finalVersion: match[1], milestone: match[2] ?? 'final' };
}

export function rcLine(tag, finalVersion) {
  const line = releaseLine(tag);
  assert.equal(line.milestone, 'rc', 'expected a coordinated release candidate');
  if (finalVersion !== undefined) {
    const final = releaseLine(`v${finalVersion}`);
    assert.equal(final.milestone, 'final', 'final version must be stable');
    assert.equal(line.finalVersion, final.version, 'RC and final version lines differ');
  }
  return line;
}
