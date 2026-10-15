import { h, createSignal, createComputed, createShow, createList } from '@getforma/core';
import { createFetch } from '@getforma/core/http';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { UserAvatar } from '../components/UserAvatar';
import { Icon } from '../components/Icon';
import { ICON_GIT_BRANCH, ICON_SEARCH } from '../components/icons';

interface DeploymentStats {
  today_deploys: number;
  success_rate: number;
  avg_duration: string;
  rollbacks: number;
}

interface Deployment {
  id: number;
  service: string;
  version: string;
  branch: string;
  environment: string;
  status: string;
  duration_secs: number;
  deployed_by: string;
  commit_hash: string;
  time_ago: string;
}

function formatDuration(secs: number): string {
  if (secs === 0) return '-';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const ENV_CLASSES: Record<string, string> = {
  production:  'bg-gruvbox-red/10 text-gruvbox-red',
  staging:     'bg-gruvbox-yellow/10 text-gruvbox-yellow',
  development: 'bg-gruvbox-blue/10 text-gruvbox-blue',
};

export function DeploymentsPage() {
  const stats = createFetch<DeploymentStats>('/api/deployment-stats');
  const deployments = createFetch<Deployment[]>('/api/deployments');

  const [search, setSearch] = createSignal('');
  let searchTimer: number | undefined;
  const onSearch = (e: Event) => {
    clearTimeout(searchTimer);
    const val = (e.target as HTMLInputElement).value;
    searchTimer = window.setTimeout(() => setSearch(val.toLowerCase()), 200);
  };

  const filtered = createComputed(() => {
    const list = deployments.data();
    if (!list) return [];
    const q = search();
    if (!q) return list;
    return list.filter(d =>
      d.service.toLowerCase().includes(q) ||
      d.version.toLowerCase().includes(q) ||
      d.branch.toLowerCase().includes(q) ||
      d.deployed_by.toLowerCase().includes(q) ||
      d.environment.toLowerCase().includes(q) ||
      d.status.toLowerCase().includes(q)
    );
  });

  return (
    <div class="space-y-6">
      {/* Stat Cards */}
      {createShow(
        () => !!stats.data(),
        () => {
          const d = stats.data()!;
          return (
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard label="Today's Deploys" value={String(d.today_deploys)} index={0} />
              <StatCard label="Success Rate" value={`${d.success_rate}%`} change={2.4} trend="up" index={1} />
              <StatCard label="Avg Duration" value={d.avg_duration} index={2} />
              <StatCard label="Rollbacks" value={String(d.rollbacks)} index={3} />
            </div>
          );
        },
      )}

      {/* Loading skeleton for stat cards */}
      {createShow(
        () => stats.loading() && !stats.data(),
        () => (
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[0,1,2,3].map(i => (
              <div class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-5 space-y-3">
                <div class="h-3 w-20 bg-gruvbox-border rounded animate-pulse-slow" />
                <div class="h-8 w-24 bg-gruvbox-border rounded animate-pulse-slow" />
              </div>
            ))}
          </div>
        ),
      )}

      {/* Deployment History Table */}
      <div class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gruvbox-border">
          <h3 class="text-sm font-semibold text-gruvbox-fg">Deployment History</h3>
          <div class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gruvbox-bg border border-gruvbox-border text-xs w-64">
            <Icon d={ICON_SEARCH} size={14} class="text-gruvbox-gray" />
            <input
              type="text"
              placeholder="Search deployments..."
              class="bg-transparent border-none outline-none text-gruvbox-fg text-xs w-full placeholder:text-gruvbox-gray/60"
              onInput={onSearch}
            />
          </div>
        </div>

        {/* Loading skeleton for table */}
        {createShow(
          () => deployments.loading() && !deployments.data(),
          () => (
            <div class="p-5 space-y-3">
              {[0,1,2,3,4].map(() => (
                <div class="h-12 bg-gruvbox-border/30 rounded animate-pulse-slow" />
              ))}
            </div>
          ),
        )}

        {/* Error state */}
        {createShow(
          () => !!deployments.error(),
          () => (
            <div class="p-5 text-sm text-gruvbox-red">
              Failed to load deployments: {() => deployments.error()?.message || 'Unknown error'}
            </div>
          ),
        )}

        {/* Table */}
        {createShow(
          () => !!deployments.data(),
          () => (
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gruvbox-border text-left">
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Service</th>
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Version</th>
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Branch</th>
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Environment</th>
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Status</th>
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Duration</th>
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Deployed By</th>
                    <th class="px-5 py-3 text-xs font-medium text-gruvbox-gray uppercase tracking-wider">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {createList(
                    filtered,
                    (dep) => dep.id,
                    (dep, i) => (
                    <tr
                      class="border-b border-gruvbox-border/50 hover:bg-white/[0.02] transition-colors animate-fade-in"
                      style={`animation-delay: ${i() * 30}ms`}
                    >
                      <td class="px-5 py-3">
                        <span class="font-medium text-gruvbox-fg">{dep.service}</span>
                      </td>
                      <td class="px-5 py-3">
                        <span class="font-mono text-gruvbox-blue text-xs">{dep.version}</span>
                        <span class="text-gruvbox-gray text-[10px] ml-1.5">{dep.commit_hash}</span>
                      </td>
                      <td class="px-5 py-3">
                        <div class="flex items-center gap-1.5 text-xs text-gruvbox-gray">
                          <Icon d={ICON_GIT_BRANCH} size={13} />
                          {dep.branch}
                        </div>
                      </td>
                      <td class="px-5 py-3">
                        <span class={`inline-block px-2 py-0.5 rounded text-[10px] font-medium tracking-wide ${ENV_CLASSES[dep.environment] || 'bg-gruvbox-gray/20 text-gruvbox-gray'}`}>
                          {dep.environment}
                        </span>
                      </td>
                      <td class="px-5 py-3">
                        <StatusBadge status={dep.status} dot={true} />
                      </td>
                      <td class="px-5 py-3">
                        <span class="font-mono text-xs text-gruvbox-gray">{formatDuration(dep.duration_secs)}</span>
                      </td>
                      <td class="px-5 py-3">
                        <div class="flex items-center gap-2">
                          <UserAvatar name={dep.deployed_by} />
                          <span class="text-xs text-gruvbox-gray">{dep.deployed_by}</span>
                        </div>
                      </td>
                      <td class="px-5 py-3">
                        <span class="text-xs text-gruvbox-gray">{dep.time_ago}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {createShow(
                () => filtered().length === 0 && search() !== '',
                () => (
                  <div class="px-5 py-8 text-center text-sm text-gruvbox-gray">
                    No deployments matching "{() => search()}"
                  </div>
                ),
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
