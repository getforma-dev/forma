import { h, createEffect } from '@getforma/core';
import { createFetch } from '@getforma/core/http';
import { formatNumber, formatCurrency, formatPercent } from '../lib/format';

interface Stats {
  users: number;
  uptime: number;
  revenue: number;
  active_sessions: number;
}

export function StatsCards(el: HTMLElement, props: Record<string, unknown> | null) {
  const { data: stats, loading, error } = createFetch<Stats>('/api/stats');

  // Fix 2: Dispatch custom event when stats load so other islands can react
  createEffect(() => {
    const s = stats();
    if (s) {
      el.dispatchEvent(new CustomEvent('stats-loaded', {
        bubbles: true, composed: true, detail: s,
      }));
    }
  });

  const statCard = (label: string, valueFn: () => string, colorClass?: string) =>
    <div class="card">
      <div class="card-label">{label}</div>
      <div class={`card-value ${colorClass ?? ''}`}>{valueFn}</div>
    </div>;

  return (
    <div class="stats-grid">
      {statCard('Users', () => loading() ? '...' : formatNumber(stats()?.users ?? 0))}
      {statCard('Uptime', () => loading() ? '...' : formatPercent(stats()?.uptime ?? 0), 'text-success')}
      {statCard('Revenue', () => loading() ? '...' : formatCurrency(stats()?.revenue ?? 0))}
      {statCard('Sessions', () => loading() ? '...' : String(stats()?.active_sessions ?? 0))}
      {() => error() ? <p class="error">Failed to load stats: {() => error()?.message}</p> : null}
    </div>
  );
}
