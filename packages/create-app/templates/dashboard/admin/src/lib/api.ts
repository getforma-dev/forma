import { createFetch } from '@getforma/core/http';

export interface Stats {
  users: number;
  uptime: number;
  revenue: number;
  active_sessions: number;
}

export interface Activity {
  id: number;
  message: string;
  time_ago: string;
  kind: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
}

export const fetchStats = () => createFetch<Stats>('/api/stats');
export const fetchActivity = () => createFetch<Activity[]>('/api/activity');
export const fetchUsers = () => createFetch<User[]>('/api/users');
