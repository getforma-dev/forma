import { h, createSignal, createShow } from '@getforma/core';

export function Sidebar(el: HTMLElement, props: Record<string, unknown> | null) {
  const [active, setActive] = createSignal('overview');
  const [collapsed, setCollapsed] = createSignal(false);

  const navItem = (id: string, icon: string, label: string) => (
    <a
      class={() => `nav-item ${active() === id ? 'active' : ''}`}
      onClick={() => setActive(id)}
    >
      <span class="nav-icon">{icon}</span>
      {createShow(
        () => !collapsed(),
        () => <span class="nav-label">{label}</span>,
      )}
    </a>
  );

  return (
    <nav class={() => `sidebar ${collapsed() ? 'collapsed' : ''}`}>
      <button class="sidebar-toggle" onClick={() => setCollapsed(c => !c)}>
        {() => collapsed() ? '\u2192' : '\u2190'}
      </button>
      <div class="nav-items">
        {navItem('overview', '\uD83D\uDCCA', 'Overview')}
        {navItem('users', '\uD83D\uDC65', 'Users')}
        {navItem('revenue', '\uD83D\uDCB0', 'Revenue')}
        {navItem('settings', '\u2699\uFE0F', 'Settings')}
      </div>
    </nav>
  );
}
