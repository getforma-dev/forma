import { h, mount } from '@getforma/core';
import { StatsCards } from './islands/StatsCards';
import { Sidebar } from './islands/Sidebar';
import { ActivityFeed } from './islands/ActivityFeed';
import { DataTable } from './islands/DataTable';

/**
 * Dashboard layout — renders the full page client-side.
 *
 * Each island is mounted into its own container div. The island functions
 * receive the container element and return their DOM tree, which we
 * append to the layout.
 *
 * When SSR Phase 2 is enabled (IR modules compiled), switch to
 * activateIslands() for hydration instead of client-side mount.
 */
mount(() => {
  // Create containers for each island
  const statsContainer = document.createElement('div');
  statsContainer.className = 'stats-section';

  const sidebarContainer = document.createElement('div');

  const activityContainer = document.createElement('div');
  activityContainer.className = 'activity-section';

  const tableContainer = document.createElement('div');
  tableContainer.className = 'table-section';

  // Mount each island into its container
  const statsTree = StatsCards(statsContainer, null);
  if (statsTree instanceof Node) statsContainer.appendChild(statsTree);

  const sidebarTree = Sidebar(sidebarContainer, null);
  if (sidebarTree instanceof Node) sidebarContainer.appendChild(sidebarTree);

  const activityTree = ActivityFeed(activityContainer, null);
  if (activityTree instanceof Node) activityContainer.appendChild(activityTree);

  const tableTree = DataTable(tableContainer, null);
  if (tableTree instanceof Node) tableContainer.appendChild(tableTree);

  // Build the dashboard layout
  return h('div', { class: 'dashboard-layout' },
    sidebarContainer,
    h('main', { class: 'main-content' },
      h('div', { class: 'page-header' },
        h('h2', null, 'Dashboard'),
        h('p', null, 'Overview of your application metrics and activity.'),
      ),
      statsContainer,
      h('div', { class: 'content-grid' },
        h('div', { class: 'panel' },
          activityContainer,
        ),
        h('div', { class: 'panel' },
          tableContainer,
        ),
      ),
    ),
  );
}, '#app');
