import { h, createSignal, createList, onMount } from '@getforma/core';

interface Activity {
  id: number;
  message: string;
  time_ago: string;
  kind: string;
}

const KIND_ICONS: Record<string, string> = {
  signup: '\uD83D\uDC64', payment: '\uD83D\uDCB3', report: '\uD83D\uDCCA', deploy: '\uD83D\uDE80',
};

export function ActivityFeed(el: HTMLElement, props: Record<string, unknown> | null) {
  const [items, setItems] = createSignal<Activity[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const loadData = () => {
    fetch('/api/activity')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setItems(data); setLoading(false); setError(null); })
      .catch(err => { setError(err.message); setLoading(false); });
  };

  onMount(() => {
    loadData();
    const id = setInterval(loadData, 30_000);
    return () => clearInterval(id);
  });

  return (
    <div class="activity-feed">
      <h3 class="section-title">Recent Activity</h3>
      {() => loading() && items().length === 0 ? <p class="loading">Loading...</p> : null}
      {() => error() ? <p class="error">{error()}</p> : null}
      {createList(
        items,
        (item) => item.id,
        (item) => (
          <div class="activity-item">
            <span class="activity-icon">{KIND_ICONS[item.kind] ?? '\u25CF'}</span>
            <span class="activity-message">{item.message}</span>
            <span class="activity-time">{item.time_ago}</span>
          </div>
        ),
      )}
    </div>
  );
}
