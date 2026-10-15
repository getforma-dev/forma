/** Every edit addresses the same original, authenticated source snapshot. */
export interface SourceEdit { readonly start: number; readonly end: number; readonly text: string }

/** Compose replacements and wrapper insertions without ever using shifted spans. */
export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
  const ordered = edits.map((edit, index) => ({ ...edit, index })).sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
  let replacedThrough = -1;
  for (const edit of ordered) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      throw new Error('source edit is outside the original snapshot');
    }
    if (edit.start < replacedThrough) throw new Error('source edits overlap in the original snapshot');
    if (edit.end > edit.start) replacedThrough = edit.end;
  }
  let result = source;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const edit = ordered[i]!;
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
