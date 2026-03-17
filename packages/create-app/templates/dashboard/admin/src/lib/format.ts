export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCurrency(n: number): string {
  return `$${formatNumber(n)}`;
}

export function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}
