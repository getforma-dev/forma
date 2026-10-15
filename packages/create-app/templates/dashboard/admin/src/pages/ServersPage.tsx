import { h, createSignal, createShow, createComputed, createList } from '@getforma/core';
import { createFetch } from '@getforma/core/http';
import { StatusBadge } from '../components/StatusBadge';
import { ProgressBar } from '../components/ProgressBar';

interface Server {
  name: string;
  ip: string;
  status: string;
  region: string;
  os: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  uptime: string;
}

type FilterStatus = 'all' | 'online' | 'degraded' | 'offline';

export function ServersPage() {
  const servers = createFetch<Server[]>('/api/servers');
  const [filter, setFilter] = createSignal<FilterStatus>('all');

  const filtered = createComputed(() => {
    const list = servers.data();
    if (!list) return [];
    const f = filter();
    return f === 'all' ? list : list.filter(s => s.status === f);
  });

  const counts = createComputed(() => {
    const list = servers.data();
    if (!list) return { all: 0, online: 0, degraded: 0, offline: 0 };
    return {
      all: list.length,
      online: list.filter(s => s.status === 'online').length,
      degraded: list.filter(s => s.status === 'degraded').length,
      offline: list.filter(s => s.status === 'offline').length,
    };
  });

  const filterTab = (status: FilterStatus, label: string) => (
    <button
      class={() => {
        const base = 'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150';
        const active = filter() === status
          ? 'bg-white/10 text-gruvbox-fg'
          : 'text-gruvbox-gray hover:text-gruvbox-fg hover:bg-white/5';
        return `${base} ${active}`;
      }}
      onClick={() => setFilter(status)}
    >
      {label} ({() => counts()[status]})
    </button>
  );

  return (
    <div class="space-y-6">
      {/* Filter tabs */}
      <div class="flex items-center gap-1 bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-1 w-fit">
        {filterTab('all', 'All')}
        {filterTab('online', 'Online')}
        {filterTab('degraded', 'Degraded')}
        {filterTab('offline', 'Offline')}
      </div>

      {/* Error state */}
      {createShow(
        () => !!servers.error(),
        () => (
          <div class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-5 text-sm text-gruvbox-red">
            Failed to load servers: {() => servers.error()?.message || 'Unknown error'}
          </div>
        ),
      )}

      {/* Loading skeleton */}
      {createShow(
        () => servers.loading() && !servers.data(),
        () => (
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[0,1,2,3,4,5].map(() => (
              <div class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-5 space-y-4">
                <div class="h-4 w-32 bg-gruvbox-border rounded animate-pulse-slow" />
                <div class="h-3 w-24 bg-gruvbox-border rounded animate-pulse-slow" />
                <div class="space-y-2">
                  <div class="h-2 w-full bg-gruvbox-border rounded animate-pulse-slow" />
                  <div class="h-2 w-full bg-gruvbox-border rounded animate-pulse-slow" />
                  <div class="h-2 w-full bg-gruvbox-border rounded animate-pulse-slow" />
                </div>
              </div>
            ))}
          </div>
        ),
      )}

      {/* Server grid */}
      {createShow(
        () => !!servers.data(),
        () => (
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {createList(
              filtered,
              (server) => server.name,
              (server, i) => (
              <div
                class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-5 transition-all duration-150 hover:border-gruvbox-gray/50 animate-fade-in"
                style={`animation-delay: ${i() * 60}ms`}
              >
                {/* Header */}
                <div class="flex items-center justify-between mb-3">
                  <div>
                    <div class="text-sm font-semibold text-gruvbox-fg">{server.name}</div>
                    <div class="text-[11px] text-gruvbox-gray font-mono mt-0.5">{server.ip}</div>
                  </div>
                  <StatusBadge status={server.status} />
                </div>

                {/* Info row */}
                <div class="flex items-center gap-3 text-[11px] text-gruvbox-gray mb-4">
                  <span>{server.region}</span>
                  <span class="text-gruvbox-border">|</span>
                  <span>{server.os}</span>
                </div>

                {/* Resource bars */}
                <div class="space-y-2.5">
                  <ProgressBar label="CPU" value={server.cpu_percent} />
                  <ProgressBar label="Memory" value={server.memory_percent} />
                  <ProgressBar label="Disk" value={server.disk_percent} />
                </div>

                {/* Footer */}
                <div class="flex items-center justify-between mt-4 pt-3 border-t border-gruvbox-border/50 text-[11px] text-gruvbox-gray">
                  <span>Uptime: {server.uptime}</span>
                </div>
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
