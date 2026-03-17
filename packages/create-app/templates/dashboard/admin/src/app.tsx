import { activateIslands } from '@getforma/core';
import { StatsCards } from './islands/StatsCards';
import { Sidebar } from './islands/Sidebar';
import { ActivityFeed } from './islands/ActivityFeed';
import { DataTable } from './islands/DataTable';

activateIslands({
  StatsCards,
  Sidebar,
  ActivityFeed,
  DataTable,
});
