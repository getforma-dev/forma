import { h, createList, onCleanup } from '@getforma/core';
import { createFetch } from '@getforma/core/http';

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
  const { data: items, loading, error, refetch } = createFetch<Activity[]>('/api/activity');

  // Auto-refresh every 30 seconds using refetch from createFetch
  const intervalId = setInterval(refetch, 30_000);
  onCleanup(() => clearInterval(intervalId));

  return (
    <div class="activity-feed">
      <h3 class="section-title">Recent Activity</h3>
      {() => loading() && !items() ? <p class="loading">Loading...</p> : null}
      {() => error() ? <p class="error">{() => error()?.message}</p> : null}
      {createList(
        () => items() ?? [],
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
