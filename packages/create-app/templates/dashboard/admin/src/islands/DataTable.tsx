import { h, createSignal, createComputed, createList, onMount, batch } from '@getforma/core';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
}

export function DataTable(el: HTMLElement, props: Record<string, unknown> | null) {
  const [users, setUsers] = createSignal<User[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [sortCol, setSortCol] = createSignal('name');
  const [sortDir, setSortDir] = createSignal<'asc' | 'desc'>('asc');
  const [search, setSearch] = createSignal('');

  // Debounced search
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  const onSearch = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => setSearch(value), 300);
  };

  onMount(() => {
    fetch('/api/users')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setUsers(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  });

  const filtered = createComputed(() => {
    const list = users();
    const q = search().toLowerCase();
    const result = q
      ? list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : list;

    const col = sortCol();
    const dir = sortDir();
    return [...result].sort((a, b) => {
      const av = String((a as any)[col] ?? '');
      const bv = String((b as any)[col] ?? '');
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  });

  const toggleSort = (col: string) => {
    batch(() => {
      if (sortCol() === col) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      } else {
        setSortCol(col);
        setSortDir('asc');
      }
    });
  };

  const sortHeader = (col: string, label: string) => (
    <th class="sortable" onClick={() => toggleSort(col)}>
      {label}
      {() => sortCol() === col ? (sortDir() === 'asc' ? ' \u2191' : ' \u2193') : ''}
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
              setSearch('');
            }
          }}
        />
      </div>
      {() => loading() ? <p class="loading">Loading users...</p> : null}
      {() => error() ? <p class="error">{error()}</p> : null}
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
