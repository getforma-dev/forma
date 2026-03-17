import { h, createComputed, createList, createStore } from '@getforma/core';
import { createFetch } from '@getforma/core/http';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
}

export function DataTable(el: HTMLElement, props: Record<string, unknown> | null) {
  // Fix 1: Use createFetch instead of raw fetch
  const { data: users, loading, error } = createFetch<User[]>('/api/users');

  // Fix 5: Use createStore for table UI state (deep reactivity)
  const [tableState, setTableState] = createStore({
    sortCol: 'name',
    sortDir: 'asc' as 'asc' | 'desc',
    search: '',
  });

  // Debounced search
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  const onSearch = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { tableState.search = value; }, 300);
  };

  const filtered = createComputed(() => {
    const list = users() ?? [];
    const q = tableState.search.toLowerCase();
    const result = q
      ? list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : list;

    const col = tableState.sortCol;
    const dir = tableState.sortDir;
    return [...result].sort((a, b) => {
      const av = String((a as any)[col] ?? '');
      const bv = String((b as any)[col] ?? '');
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  });

  const toggleSort = (col: string) => {
    if (tableState.sortCol === col) {
      tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      setTableState({ sortCol: col, sortDir: 'asc' });
    }
  };

  const sortHeader = (col: string, label: string) => (
    <th class="sortable" onClick={() => toggleSort(col)}>
      {label}
      {() => tableState.sortCol === col ? (tableState.sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''}
    </th>
  );

  const badgeClass = (status: string) => `badge badge-${status.toLowerCase()}`;

  return (
    <div class="data-table-container">
      <div class="table-toolbar">
        <h3 class="section-title">Users</h3>
        <input
          type="text"
          class="search-input"
          placeholder="Search users..."
          onInput={onSearch}
          onKeydown={(e: Event) => {
            if ((e as KeyboardEvent).key === 'Escape') {
              (e.target as HTMLInputElement).value = '';
              tableState.search = '';
            }
          }}
        />
      </div>
      {() => loading() ? <p class="loading">Loading users...</p> : null}
      {() => error() ? <p class="error">{() => error()?.message}</p> : null}
      <table class="data-table">
        <thead>
          <tr>
            {sortHeader('name', 'Name')}
            {sortHeader('email', 'Email')}
            {sortHeader('role', 'Role')}
            {sortHeader('status', 'Status')}
          </tr>
        </thead>
        <tbody>
          {createList(
            filtered,
            (user) => user.id,
            (user) => (
              <tr>
                <td class="user-name">{user.name}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td><span class={badgeClass(user.status)}>{user.status}</span></td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <div class="table-footer">
        {() => `${filtered().length} user${filtered().length !== 1 ? 's' : ''}`}
      </div>
    </div>
  );
}
