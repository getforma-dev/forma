// Each (seed, rule, index) is independently reproducible, including batch boundaries.
export function generate(seed, rule, index) {
  let state = (seed ^ Math.imul(rule, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  const next = () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return (t ^ t >>> 14) >>> 0; };
  const pick = values => values[next() % values.length];
  const words = ['', 'a', '<&"', '\r', '\r\n', '\0', '😀', 'e\u0301', '\u200b', '尾'];
  const string = () => Array.from({ length: next() % 6 }, () => pick(words)).join('');
  const before = string(), after = string();
  const result = { rule, index, before, after, tag: 'p', attr: pick(['title', 'data-note', 'aria-label']), value: '' };
  if (rule === 1) result.value = string();
  if (rule === 2) {
    const edge = ['-0', '5e-324', '1.7976931348623157e308', '1e-7', '1e-6', '1e20', '1e21', '9007199254740993'];
    const view = new DataView(new ArrayBuffer(8)); view.setUint32(0, next()); view.setUint32(4, next());
    const number = view.getFloat64(0);
    result.value = index % 8 === 0 || !Number.isFinite(number) ? pick(edge) : String(number);
  }
  if (rule === 3) {
    const edge = [-9007199254740992n, -9007199254740991n, 0n, 9007199254740991n, 9007199254740992n, 18446744073709551615n, -9223372036854775808n];
    let integer = BigInt(next()) << 32n | BigInt(next());
    // Most generated integer inputs reach all three DOM paths; a measured
    // minority retain exact unsafe origins and exercise the native refusal.
    if (index % 8) integer %= 9007199254740992n;
    if (next() & 1) integer = -BigInt.asIntN(63, integer);
    result.value = String(index % 16 === 0 ? pick(edge) : integer);
  }
  if (rule === 4) {
    const bound = 8640000000000000000000n;
    const edge = [-bound - 1000000n, -bound, -1500000n, -1n, 0n, 1n, 1500000n, bound, bound + 1000000n];
    let nanos = (BigInt(next()) << 32n | BigInt(next())) * 1000n % (bound + 10000000000n);
    if (next() & 1) nanos = -nanos;
    result.value = String(index % 16 === 0 ? pick(edge) : nanos);
  }
  if (rule === 5) result.value = pick(['null', 'undefined']);
  if (rule === 6 || rule === 7) result.value = Boolean(next() & 1);
  if (rule === 6) { result.tag = 'button'; result.attr = pick(['disabled', 'hidden', 'aria-pressed', 'data-live']); }
  return result;
}
export function admission(input) {
  if (input.rule === 3) {
    const n = BigInt(input.value); return n < -9007199254740991n || n > 9007199254740991n ? 'RENDER-401' : null;
  }
  if (input.rule === 4) {
    const millis = BigInt(input.value) / 1000000n; return millis < -8640000000000000n || millis > 8640000000000000n ? 'RENDER-403' : null;
  }
  return null;
}
