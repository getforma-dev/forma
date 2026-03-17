import { h, createSignal, createEffect, onMount } from '@getforma/core';
import { createFetch } from '@getforma/core/http';
import { formatNumber, formatCurrency, formatPercent } from '../lib/format';

interface Stats {
  users: number;
  uptime: number;
  revenue: number;
  active_sessions: number;
}

export function StatsCards(el: HTMLElement, props: Record<string, unknown> | null) {
  const [stats, setStats] = createSignal<Stats | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    fetch('/api/stats')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setStats(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
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
      {() => error() ? <p class="error">Failed to load stats: {error()}</p> : null}
    </div>
  );
}
