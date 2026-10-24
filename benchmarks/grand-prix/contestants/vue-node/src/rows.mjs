// Request parsing shared by every runtime: `?rows=N`, N in {10, 100, 1000}, default 100.
import { ALLOWED_ROWS } from './dataset.mjs';

export function parseRows(search) {
  const raw = new URLSearchParams(search).get('rows');
  if (raw === null) return 100;
  const n = Number(raw);
  return ALLOWED_ROWS.includes(n) ? n : 0; // 0 = invalid
}
