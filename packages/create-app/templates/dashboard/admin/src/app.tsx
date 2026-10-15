import { h, Fragment, mount, createSignal, createShow, createEffect, onCleanup } from '@getforma/core';
import { Icon } from './components/Icon';
import { UserAvatar } from './components/UserAvatar';
import {
  ICON_DASHBOARD, ICON_BAR_CHART, ICON_SERVER, ICON_BOX,
  ICON_ROCKET, ICON_ALERT_TRIANGLE, ICON_SETTINGS, ICON_HELP,
  ICON_CHEVRON_LEFT, ICON_CHEVRON_RIGHT, ICON_SEARCH, ICON_PLUS,
} from './components/icons';
import { DeploymentsPage } from './pages/DeploymentsPage';
import { OverviewPage } from './pages/OverviewPage';
import { ServersPage } from './pages/ServersPage';
import { SettingsPage } from './pages/SettingsPage';

// ── Routing via signal + History API ──

const initialPage = location.pathname.slice(1) || 'overview';
export const [currentPage, setCurrentPage] = createSignal(initialPage);

// ── Page metadata ──

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  overview:    { title: 'Infrastructure Overview', subtitle: 'Real-time monitoring across all environments.' },
  deployments: { title: 'Deployments', subtitle: 'Track and manage service deployments across environments.' },
  servers:     { title: 'Server Fleet', subtitle: 'Monitor and manage your infrastructure.' },
  settings:    { title: 'Settings', subtitle: 'Configure your system preferences.' },
};

// ── Command Palette ──
const [paletteOpen, setPaletteOpen] = createSignal(false);
const [paletteQuery, setPaletteQuery] = createSignal('');

const PALETTE_ITEMS = [
  { id: 'overview', label: 'Dashboard', subtitle: 'Infrastructure overview' },
  { id: 'deployments', label: 'Deployments', subtitle: 'Deployment history and stats' },
  { id: 'servers', label: 'Servers', subtitle: 'Server fleet management' },
  { id: 'settings', label: 'Settings', subtitle: 'System configuration' },
];

// ── Deploy Toast ──
const [toastVisible, setToastVisible] = createSignal(false);
const showToast = () => {
  setToastVisible(true);
  setTimeout(() => setToastVisible(false), 3000);
};

// ── Navigation helper ──

function navigate(page: string) {
  setCurrentPage(page);
}

// ── Sidebar Component ──

function Sidebar() {
  const [collapsed, setCollapsed] = createSignal(false);

  const navItem = (id: string, icon: string, label: string, badge?: number, disabled?: boolean) => (
    <button
      class={() => {
        const base = 'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium transition-all duration-150';
        const active = currentPage() === id
          ? 'bg-white/10 text-forma-green neon-glow'
          : 'text-gruvbox-gray hover:text-gruvbox-fg hover:bg-white/5';
        const dis = disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer';
        return `${base} ${active} ${dis}`;
      }}
      onClick={() => { if (!disabled) navigate(id); }}
    >
      <Icon d={icon} size={18} />
      {createShow(
        () => !collapsed(),
        () => (
          <>
            <span class="flex-1 text-left">{label}</span>
            {badge !== undefined && (
              <span class="bg-gruvbox-red/20 text-gruvbox-red text-[10px] font-semibold px-1.5 py-0.5 rounded-full">{badge}</span>
            )}
          </>
        ),
      )}
    </button>
  );

  const sectionTitle = (title: string) =>
    createShow(
      () => !collapsed(),
      () => <div class="text-[10px] font-semibold text-gruvbox-gray uppercase tracking-widest px-3 pt-4 pb-1">{title}</div>,
    );

  return (
    <nav class={() => `flex flex-col h-screen bg-gruvbox-bg-hard border-r border-gruvbox-border transition-all duration-200 ${collapsed() ? 'w-[60px]' : 'w-[240px]'}`}>
      {/* Brand */}
      <div class="flex items-center gap-2 px-4 h-14 border-b border-gruvbox-border shrink-0">
        {createShow(
          () => !collapsed(),
          () => <span class="text-lg font-semibold text-gruvbox-fg tracking-tight">FormaOps</span>,
        )}
        <button
          class="ml-auto text-gruvbox-gray hover:text-gruvbox-fg transition-colors p-1 rounded hover:bg-white/5"
          onClick={() => setCollapsed(c => !c)}
        >
          {createShow(
            () => collapsed(),
            () => <Icon d={ICON_CHEVRON_RIGHT} size={16} />,
            () => <Icon d={ICON_CHEVRON_LEFT} size={16} />,
          )}
        </button>
      </div>

      {/* Navigation */}
      <div class="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {sectionTitle('Overview')}
        {navItem('overview', ICON_DASHBOARD, 'Dashboard')}
        {navItem('analytics', ICON_BAR_CHART, 'Analytics', undefined, true)}

        {sectionTitle('Infrastructure')}
        {navItem('servers', ICON_SERVER, 'Servers')}
        {navItem('containers', ICON_BOX, 'Containers', undefined, true)}

        {sectionTitle('Operations')}
        {navItem('deployments', ICON_ROCKET, 'Deployments', 3)}
        {navItem('incidents', ICON_ALERT_TRIANGLE, 'Incidents', 2, true)}

        {sectionTitle('System')}
        {navItem('settings', ICON_SETTINGS, 'Settings')}
        {navItem('help', ICON_HELP, 'Help & Support', undefined, true)}
      </div>

      {/* User profile */}
      <div class="border-t border-gruvbox-border p-3">
        <div class="flex items-center gap-2">
          <UserAvatar name="Admin User" size="md" />
          {createShow(
            () => !collapsed(),
            () => (
              <div class="min-w-0">
                <div class="text-sm font-medium text-gruvbox-fg truncate">Admin User</div>
                <div class="text-[11px] text-gruvbox-gray truncate">Admin</div>
              </div>
            ),
          )}
        </div>
      </div>
    </nav>
  );
}

// ── TopBar Component ──

function TopBar() {
  return (
    <div class="flex items-center justify-between px-8 h-14 border-b border-gruvbox-border shrink-0">
      <div>
        <h1 class="text-xl font-semibold text-gruvbox-fg">
          {() => PAGE_META[currentPage()]?.title || 'Dashboard'}
        </h1>
        <p class="text-xs text-gruvbox-gray mt-0.5">
          {() => PAGE_META[currentPage()]?.subtitle || ''}
        </p>
      </div>
      <div class="flex items-center gap-3">
        {/* Command palette hint */}
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gruvbox-bg border border-gruvbox-border text-xs text-gruvbox-gray cursor-pointer hover:border-gruvbox-gray/50 transition-colors"
             onClick={() => { setPaletteOpen(true); setPaletteQuery(''); }}>
          <Icon d={ICON_SEARCH} size={14} />
          <span>Search anything...</span>
          <kbd class="text-[10px] bg-gruvbox-bg-hard px-1.5 py-0.5 rounded border border-gruvbox-border font-mono">⌘K</kbd>
        </div>
        {/* New Deploy button */}
        <button class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-forma-green/10 text-forma-green text-xs font-medium hover:bg-forma-green/20 transition-colors"
                onClick={showToast}>
          <Icon d={ICON_PLUS} size={14} />
          New Deploy
        </button>
        {/* User avatar */}
        <UserAvatar name="Admin User" size="md" />
      </div>
    </div>
  );
}

// ── Mount ──

mount(() => {
  // History API sync
  createEffect(() => {
    const page = currentPage();
    const path = '/' + (page === 'overview' ? '' : page);
    if (location.pathname !== path) {
      history.pushState(null, '', path);
    }
  });

  const onPopState = () => setCurrentPage(location.pathname.slice(1) || 'overview');
  window.addEventListener('popstate', onPopState);
  onCleanup(() => window.removeEventListener('popstate', onPopState));

  // ⌘K to open command palette
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setPaletteOpen(o => !o);
      setPaletteQuery('');
    }
    if (e.key === 'Escape') setPaletteOpen(false);
  };
  window.addEventListener('keydown', onKeyDown);
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  return (
    <>
      <div class="flex h-screen bg-gruvbox-bg text-gruvbox-fg overflow-hidden">
        <Sidebar />
        <div class="flex-1 flex flex-col overflow-hidden">
          <TopBar />
          <main class="flex-1 overflow-y-auto p-8">
            {createShow(() => currentPage() === 'overview', () => <OverviewPage />)}
            {createShow(() => currentPage() === 'deployments', () => <DeploymentsPage />)}
            {createShow(() => currentPage() === 'servers', () => <ServersPage />)}
            {createShow(() => currentPage() === 'settings', () => <SettingsPage />)}
          </main>
        </div>
      </div>

      {/* Command Palette Modal */}
      {createShow(
        () => paletteOpen(),
        () => (
          <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
               onClick={(e: MouseEvent) => { if (e.target === e.currentTarget) setPaletteOpen(false); }}>
            <div class="fixed inset-0 bg-black/60" />
            <div class="relative w-full max-w-lg bg-gruvbox-bg-hard border border-gruvbox-border rounded-lg shadow-2xl overflow-hidden animate-fade-in" style="animation-duration: 0.15s">
              <div class="flex items-center gap-3 px-4 py-3 border-b border-gruvbox-border">
                <Icon d={ICON_SEARCH} size={16} class="text-gruvbox-gray" />
                <input
                  type="text"
                  placeholder="Search pages..."
                  class="bg-transparent border-none outline-none text-sm text-gruvbox-fg w-full placeholder:text-gruvbox-gray/60"
                  autofocus
                  onInput={(e: Event) => setPaletteQuery((e.target as HTMLInputElement).value.toLowerCase())}
                />
                <kbd class="text-[10px] text-gruvbox-gray bg-gruvbox-bg px-1.5 py-0.5 rounded border border-gruvbox-border font-mono">ESC</kbd>
              </div>
              <div class="py-2 max-h-64 overflow-y-auto">
                {() => {
                  const q = paletteQuery();
                  const items = PALETTE_ITEMS.filter(item =>
                    !q || item.label.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q)
                  );
                  return h('div', null, ...items.map(item =>
                    h('button', {
                      class: 'flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-white/5 transition-colors',
                      onClick: () => { navigate(item.id); setPaletteOpen(false); },
                    },
                      h('div', null,
                        h('div', { class: 'text-sm text-gruvbox-fg' }, item.label),
                        h('div', { class: 'text-[11px] text-gruvbox-gray' }, item.subtitle),
                      ),
                    ),
                  ));
                }}
              </div>
            </div>
          </div>
        ),
      )}

      {/* Deploy Toast */}
      {createShow(
        () => toastVisible(),
        () => (
          <div class="fixed bottom-6 right-6 z-50 bg-gruvbox-bg-hard border border-forma-green/30 rounded-lg px-4 py-3 shadow-lg animate-slide-in neon-glow flex items-center gap-3">
            <div class="w-2 h-2 rounded-full bg-forma-green" />
            <div>
              <div class="text-sm font-medium text-gruvbox-fg">Deploy Triggered</div>
              <div class="text-[11px] text-gruvbox-gray">Pipeline started for api-gateway v2.14.0</div>
            </div>
          </div>
        ),
      )}
    </>
  );
}, '#app');
